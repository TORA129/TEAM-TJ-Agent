import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  getConfigurationStatus,
  loadServerConfig,
  ServerConfigurationError,
} from '../../server/config';

function validEnvironment(): Record<string, string> {
  return {
    NODE_ENV: 'test',
    VERCEL_ENV: 'preview',
    DATABASE_URL: 'postgresql://db-user:db-password@db.example.test:5432/team_tj',
    OBJECT_STORAGE_ENDPOINT: 'https://objects.example.test',
    OBJECT_STORAGE_BUCKET: 'team-tj-private',
    OBJECT_STORAGE_ACCESS_KEY_ID: 'storage-access-key',
    OBJECT_STORAGE_SECRET_ACCESS_KEY: 'storage-secret-key',
    PI_AI_PROVIDER: 'openrouter',
    PI_AI_MODEL: 'openrouter/free',
    OPENROUTER_API_KEY: 'openrouter-secret-key',
    OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
    OPENROUTER_MODEL: 'openrouter/free',
    OPENCLI_GATEWAY_URL: 'https://opencli.example.test',
    OPENCLI_GATEWAY_TOKEN: 'opencli-secret-token',
    OPENCLI_TIMEOUT_MS: '12000',
    JOB_RUNNER: 'queue',
    JOB_QUEUE_URL: 'https://queue.example.test/jobs',
    JOB_MAX_RETRIES: '3',
    JOB_TIMEOUT_MS: '45000',
    JOB_POLL_INTERVAL_MS: '1500',
  };
}

describe('server configuration boundary', () => {
  it('parses all supported server integrations without exposing secrets in the status', () => {
    const environment = validEnvironment();
    const config = loadServerConfig(environment);
    const status = getConfigurationStatus(environment);
    const serializedStatus = JSON.stringify(status);

    expect(config.database.url).toBe(environment.DATABASE_URL);
    expect(config.jobs.runner).toBe('queue');
    expect(config.jobs.maxRetries).toBe(3);
    expect(status.overall).toBe('ready');
    expect(status.capabilities).toEqual({
      persistentWorkflows: true,
      fileAndCoverStorage: true,
      aiGeneration: true,
      openCliAccess: true,
      imageGeneration: true,
      manualWorkflows: true,
    });
    expect(serializedStatus).not.toContain('db-password');
    expect(serializedStatus).not.toContain('storage-secret-key');
    expect(serializedStatus).not.toContain('openrouter-secret-key');
    expect(serializedStatus).not.toContain('opencli-secret-token');
    expect(serializedStatus).not.toContain('postgresql://');
    expect(serializedStatus).not.toContain('objects.example.test');
    expect(serializedStatus).not.toContain('opencli.example.test');
  });

  it('classifies absent optional integrations as manual-fallback capable', () => {
    const status = getConfigurationStatus({ NODE_ENV: 'test' });

    expect(status.overall).toBe('degraded');
    expect(status.groups.database).toMatchObject({
      requirement: 'required',
      manualFallback: 'unavailable',
      readiness: 'not_configured',
      reason: 'not_configured',
    });
    expect(status.groups.openRouter).toMatchObject({
      requirement: 'optional',
      manualFallback: 'available',
      readiness: 'not_configured',
      reason: 'not_configured',
    });
    expect(status.groups.openCli).toMatchObject({
      requirement: 'optional',
      manualFallback: 'available',
      readiness: 'not_configured',
    });
    expect(status.capabilities.manualWorkflows).toBe(true);
  });

  it('reports incomplete paired configuration without echoing values', () => {
    const environment = {
      NODE_ENV: 'test',
      OBJECT_STORAGE_ENDPOINT: 'https://objects.example.test',
      OBJECT_STORAGE_BUCKET: 'team-tj-private',
      OBJECT_STORAGE_SECRET_ACCESS_KEY: 'storage-secret-key',
    };
    const status = getConfigurationStatus(environment);
    const serializedStatus = JSON.stringify(status);

    expect(status.groups.objectStorage).toMatchObject({
      readiness: 'incomplete',
      reason: 'incomplete_configuration',
      missingKeys: ['OBJECT_STORAGE_ACCESS_KEY_ID'],
    });
    expect(serializedStatus).not.toContain('objects.example.test');
    expect(serializedStatus).not.toContain('storage-secret-key');
  });

  it('rejects unsupported paid model routes and exposes only safe issue metadata', () => {
    const environment = {
      ...validEnvironment(),
      PI_AI_MODEL: 'openai/gpt-4o',
      OPENROUTER_MODEL: 'openai/gpt-4o',
    };

    expect(() => loadServerConfig(environment)).toThrow(ServerConfigurationError);

    try {
      loadServerConfig(environment);
    } catch (error) {
      expect(error).toBeInstanceOf(ServerConfigurationError);
      const configurationError = error as ServerConfigurationError;
      expect(configurationError.issues).toEqual(
        expect.arrayContaining([
          { group: 'piAi', key: 'PI_AI_MODEL', code: 'unsupported' },
          { group: 'openRouter', key: 'OPENROUTER_MODEL', code: 'unsupported' },
        ]),
      );
      expect(JSON.stringify(configurationError)).not.toContain('openai/gpt-4o');
    }
  });

  it('rejects incomplete gateway configuration with a safe validation error', () => {
    const environment = {
      NODE_ENV: 'test',
      OPENCLI_GATEWAY_URL: 'https://opencli.example.test',
    };

    expect(() => loadServerConfig(environment)).toThrowError(
      'Server configuration is invalid. Review the deployment configuration.',
    );
    const status = getConfigurationStatus(environment);
    expect(status.groups.openCli).toMatchObject({
      readiness: 'incomplete',
      missingKeys: ['OPENCLI_GATEWAY_TOKEN'],
    });
  });

  it('keeps the credential reader in the server-only boundary', () => {
    const source = readFileSync(resolve(process.cwd(), 'server/config.ts'), 'utf8');

    expect(source).toMatch(/^import ['"]server-only['"];\r?$/m);
    expect(source).not.toContain('NEXT_PUBLIC_');
  });

  it('never includes arbitrary credential values in the redacted status', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 80 }), (suffix) => {
        const secret = `${suffix}-credential-value`;
        const status = getConfigurationStatus({
          NODE_ENV: 'test',
          OPENROUTER_API_KEY: secret,
        });

        expect(JSON.stringify(status)).not.toContain(secret);
      }),
      { numRuns: 100 },
    );
  });
});
