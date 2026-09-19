#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const requiredScripts = ['build', 'lint', 'test', 'format:check', 'security:scan'];
const sensitiveKey = /(API_KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|ACCESS_KEY|CREDENTIAL)/i;

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

function checkEnvironmentTemplate(root) {
  const templatePath = path.join(root, '.env.example');
  if (!fs.existsSync(templatePath)) return ['.env.example is missing'];
  const findings = [];
  for (const [index, line] of fs.readFileSync(templatePath, 'utf8').split(/\r?\n/).entries()) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (match && match[2].trim() && !match[2].trim().startsWith('#')) {
      findings.push(`.env.example:${index + 1} contains a value for ${match[1]}`);
    }
    if (match && /^NEXT_PUBLIC_/i.test(match[1]) && sensitiveKey.test(match[1])) {
      findings.push(`.env.example:${index + 1} exposes a public credential variable`);
    }
  }
  return findings;
}

export function validatePreflight(root = process.cwd()) {
  const findings = [];
  const packagePath = path.join(root, 'package.json');
  if (!fs.existsSync(packagePath)) findings.push('package.json is missing');
  else {
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    for (const script of requiredScripts)
      if (!packageJson.scripts?.[script])
        findings.push(`package.json is missing script: ${script}`);
    if (!packageJson.engines?.node)
      findings.push('package.json is missing an explicit Node.js engine');
  }

  findings.push(...checkEnvironmentTemplate(root));
  const gitignore = fs.existsSync(path.join(root, '.gitignore'))
    ? fs.readFileSync(path.join(root, '.gitignore'), 'utf8')
    : '';
  if (!/^\.env$/m.test(gitignore) || !/^\.env\.\*$/m.test(gitignore))
    findings.push('.gitignore must exclude .env and .env.*');

  const sourceFiles = ['app', 'server', 'adapters', 'domain', 'scripts'].flatMap((directory) =>
    walk(path.join(root, directory)),
  );
  for (const file of sourceFiles) {
    if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (/NEXT_PUBLIC_(?:API_KEY|SECRET|TOKEN|PASSWORD|DATABASE|CREDENTIAL)/i.test(text)) {
      findings.push(`${path.relative(root, file)} contains a public credential variable`);
    }
  }

  const staticRoot = path.join(root, '.next', 'static');
  for (const file of walk(staticRoot)) {
    if (!/\.js$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (/OPENROUTER_API_KEY|OPENCLI_GATEWAY_TOKEN|PI_AI_API_KEY|DATABASE_URL/i.test(text)) {
      findings.push(`${path.relative(root, file)} contains a server credential identifier`);
    }
  }
  return findings;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = validatePreflight();
  if (findings.length) {
    console.error('Deployment preflight failed:');
    for (const finding of findings) console.error(`- ${finding}`);
    process.exitCode = 1;
  } else {
    console.log(
      'Deployment preflight passed: environment template, scripts, ignore rules, and static bundle checks are clean.',
    );
  }
}
