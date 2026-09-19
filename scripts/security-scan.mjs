#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const sourceRoots = ['app', 'server', 'adapters', 'domain', 'tests', 'scripts'];
const ignoredDirectories = new Set(['node_modules', '.next', 'coverage', '.git']);
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md']);
const forbiddenClientImports = [
  /(?:^|[\\/])server-only(?:$|[\\/])/i,
  /(?:^|[\\/])server[\\/](?:config|auth|security|jobs|copywriter|settings|pi-ai-model-adapter|pi-ai-tools)/i,
  /(?:^|[\\/])(?:adapters|domain)[\\/](?:persistence|object-storage)/i,
  /(?:pi-ai|openrouter|opencli)/i,
  /(?:database|credential|secret)/i,
];
const sensitiveNames = /(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|access[_-]?token|refresh[_-]?token|secret|password)/i;
const requiredSecurityMarkers = [
  ['server/http/route-protection.ts', ['resolveTrustedOperatorSession', 'assertRequestBodyLimits', 'enforceRateLimit', 'assertOriginAndCsrf']],
  ['server/security/safe-dtos.ts', ['toSafeMarkdownExport', 'safeJsonResponse']],
  ['adapters/object-storage/asset-metadata.ts', ['metadataContainsObjectBytes']],
];

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath));
    else if (sourceExtensions.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
  }
  return files;
}

function relative(file) {
  return path.relative(root, file).replaceAll(path.sep, '/');
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function addFinding(findings, file, message, line) {
  findings.push(`${relative(file)}${line ? `:${line}` : ''} — ${message}`);
}

function lineNumber(text, index) {
  return text.slice(0, index).split('\n').length;
}

function resolveImport(file, specifier) {
  const base = specifier.startsWith('@/')
    ? path.join(root, specifier.slice(2))
    : path.resolve(path.dirname(file), specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, path.join(base, 'index.ts')];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function localImportPaths(file, text) {
  const imports = [];
  const pattern = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']((?:\.?\.?\/|@\/)[^"']+)["']/g;
  for (const match of text.matchAll(pattern)) {
    const resolved = resolveImport(file, match[1]);
    if (resolved) imports.push(resolved);
  }
  return imports;
}

function scanClientBoundaries(files, findings) {
  const clientFiles = files.filter((file) => /^['"]use client['"];?/m.test(read(file)));
  const visited = new Set();
  const visit = (file) => {
    if (visited.has(file)) return;
    visited.add(file);
    const text = read(file);
    for (const imported of localImportPaths(file, text)) {
      const importedRelative = relative(imported);
      if (forbiddenClientImports.some((pattern) => pattern.test(importedRelative))) {
        addFinding(findings, file, `client bundle imports forbidden server dependency (${importedRelative})`, undefined);
      }
      visit(imported);
    }
  };
  for (const file of clientFiles) visit(file);
}

function parseEnvValues() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return [];
  return read(envPath).split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*["']?([^"'\s#]+)["']?\s*$/);
    return match?.[1] && match[1].length >= 8 ? [match[1]] : [];
  });
}

function scanSecretExposure(files, findings) {
  const envValues = parseEnvValues();
  for (const file of files) {
    if (path.basename(file) === '.env.example') continue;
    const text = read(file);
    for (const match of text.matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) {
      addFinding(findings, file, `NEXT_PUBLIC_ variable is not allowed for server credentials (${match[0]})`, lineNumber(text, match.index));
    }
    for (const value of envValues) {
      const index = text.indexOf(value);
      if (index >= 0 && relative(file) !== '.env') addFinding(findings, file, 'value from .env appears in a tracked source/test file', lineNumber(text, index));
    }
  }
}

function scanSensitiveMetadata(files, findings) {
  for (const file of files) {
    const relativeFile = relative(file);
    if (/^(tests\/|domain\/state-machines\.ts$|adapters\/object-storage\/private-object-storage\.ts$)/.test(relativeFile)) continue;
    const text = read(file);
    const metadataWrites = text.match(/(?:metadata|meta|objectMetadata)\s*[:=]\s*\{[\s\S]{0,1000}?\}/gi) ?? [];
    for (const block of metadataWrites) {
      if (sensitiveNames.test(block)) {
        addFinding(findings, file, 'sensitive header/token-like field appears in object metadata', undefined);
      }
    }
  }
}

function scanRequiredControls(findings) {
  for (const [fileName, markers] of requiredSecurityMarkers) {
    const file = path.join(root, fileName);
    if (!fs.existsSync(file)) {
      findings.push(`${fileName} — required security control file is missing`);
      continue;
    }
    const text = read(file);
    for (const marker of markers) if (!text.includes(marker)) findings.push(`${fileName} — required control is missing: ${marker}`);
  }
}

function routeDelegatesToGuardedHandler(file, text) {
  for (const imported of localImportPaths(file, text)) {
    if (read(imported).includes('withOperatorRoute')) return true;
  }
  return false;
}

function scanRouteAndExportRules(files, findings) {
  const routeFiles = files.filter((file) => /(?:^|[\\/])route\.ts$/.test(file));
  for (const file of routeFiles) {
    const text = read(file);
    const isHealthRoute = /(?:^|[\\/])api[\\/]health[\\/]route\.ts$/.test(file);
    const hasGuard = text.includes('withOperatorRoute') || routeDelegatesToGuardedHandler(file, text);
    const isSafePublicStatus = /settings[\\/]integrations[\\/]status[\\/]route\.ts$/.test(file) && /safeJsonResponse/.test(text);
    if (!isHealthRoute && !isSafePublicStatus && !hasGuard) addFinding(findings, file, 'API route is not wrapped by the operator request-security guard', undefined);
  }
  const exportFiles = files.filter((file) => /export|safe-dto|safe-dtos/i.test(file));
  for (const file of exportFiles) {
    const text = read(file);
    if (/Response\.json\s*\(/.test(text) && !/safeJsonResponse|toSafeApiDTO/.test(text)) addFinding(findings, file, 'JSON response bypasses the safe DTO boundary', undefined);
    if (/Markdown|markdown|export/i.test(text) && /return\s+[^;]*markdown|\.join\(['"]\\n/.test(text) && !/toSafeMarkdownExport/.test(text)) addFinding(findings, file, 'export text bypasses the safe Markdown export boundary', undefined);
  }
}

function main() {
  const files = sourceRoots.flatMap((directory) => walk(path.join(root, directory)));
  const findings = [];
  scanClientBoundaries(files, findings);
  scanSecretExposure(files, findings);
  scanSensitiveMetadata(files, findings);
  scanRequiredControls(findings);
  scanRouteAndExportRules(files, findings);
  if (findings.length > 0) {
    console.error('Security scan failed:');
    for (const finding of findings) console.error(`- ${finding}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Security scan passed (${files.length} source files checked).`);
}

main();
