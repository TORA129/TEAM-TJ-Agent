import { describe, expect, it } from 'vitest';

import { getConfigurationStatus } from '../server/config';

describe('integration capability status', () => {
  it('exposes safe capability flags and manual fallback when optional integrations are absent', () => {
    const status = getConfigurationStatus({ NODE_ENV: 'test' });

    expect(status.capabilities).toEqual({
      persistentWorkflows: false,
      fileAndCoverStorage: false,
      aiGeneration: false,
      openCliAccess: false,
      imageGeneration: false,
      manualWorkflows: true,
    });
    expect(status.groups.openCli).toMatchObject({
      readiness: 'not_configured',
      manualFallback: 'available',
      reason: 'not_configured',
      missingKeys: [],
    });
    expect(status.groups.openRouter).toMatchObject({ readiness: 'not_configured', manualFallback: 'available' });
  });

  it('never returns credential values in capability status', () => {
    const status = getConfigurationStatus({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://db.internal/app',
      OPENROUTER_API_KEY: 'secret-value',
      OPENCLI_GATEWAY_TOKEN: 'gateway-secret',
    });

    expect(JSON.stringify(status)).not.toContain('secret-value');
    expect(JSON.stringify(status)).not.toContain('gateway-secret');
    expect(status.groups.openRouter).toMatchObject({ readiness: 'configured', manualFallback: 'available' });
  });
});
