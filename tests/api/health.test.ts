import { describe, expect, it } from 'vitest';

import { GET } from '../../app/api/health/route';

describe('GET /api/health', () => {
  it('returns a stable, non-sensitive service health payload', async () => {
    const response = GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: 'ok',
      service: 'team-tj-xiaohongshu-ai-agent',
      version: '0.1.0',
    });
  });
});
