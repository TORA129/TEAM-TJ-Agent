import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validatePreflight } from '../scripts/deployment-preflight.mjs';

function fixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'team-tj-preflight-'));
  for (const [file, content] of Object.entries(files)) {
    const target = join(root, file);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

const packageJson = JSON.stringify({
  engines: { node: '>=20.9.0' },
  scripts: { build: 'x', lint: 'x', test: 'x', 'format:check': 'x', 'security:scan': 'x' },
});

describe('deployment preflight', () => {
  it('accepts a value-free environment template and required CI scripts', () => {
    const root = fixture({
      'package.json': packageJson,
      '.env.example': '# OPENROUTER_API_KEY=\nOPENROUTER_MODEL=\n',
      '.gitignore': '.env\n.env.*\n!.env.example\n',
    });

    expect(validatePreflight(root)).toEqual([]);
  });

  it('rejects credentials in the environment template and missing ignore rules', () => {
    const root = fixture({
      'package.json': packageJson,
      '.env.example': 'OPENROUTER_API_KEY=real-secret\n',
      '.gitignore': 'node_modules/\n',
    });

    expect(validatePreflight(root)).toEqual([
      '.env.example:1 contains a value for OPENROUTER_API_KEY',
      '.gitignore must exclude .env and .env.*',
    ]);
  });
});
