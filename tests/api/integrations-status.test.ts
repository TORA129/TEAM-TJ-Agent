import { describe, expect, it } from 'vitest';

import { GET } from '../../app/api/settings/integrations/status/route';

describe('GET /api/settings/integrations/status', () => {
  it('returns a safe configuration status DTO', async () => {
    const response = GET();
    const body = await response.json();
    const serializedBody = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body).toHaveProperty('overall');
    expect(body).toHaveProperty('groups.database');
    expect(body).toHaveProperty('groups.openRouter');
    expect(body).toHaveProperty('groups.openCli');
    expect(body).toHaveProperty('capabilities.manualWorkflows', true);
    expect(serializedBody).not.toContain('OPENROUTER_API_KEY=');
    expect(serializedBody).not.toContain('Authorization');
    expect(serializedBody).not.toContain('postgresql://');
  });
});
