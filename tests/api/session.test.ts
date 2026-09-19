import { describe, expect, it } from 'vitest';

import { GET } from '../../app/api/session/route';
import { createSessionGetHandler } from '../../app/api/session/get-handler';
import type { TrustedOperatorSession } from '../../server/auth/session';

const session: TrustedOperatorSession = {
  sessionId: 'session_123',
  operatorId: 'operator_trusted',
  roles: ['OPERATOR'],
  csrfToken: 'csrf-secret-value',
};

describe('GET /api/session', () => {
  it('fails closed when no server-side session provider is configured', async () => {
    const response = await GET(
      new Request('https://team-tj.example.test/api/session', {
        headers: { cookie: 'team_tj_session=client-supplied-token' },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.code).toBe('AUTHENTICATION_REQUIRED');
    expect(JSON.stringify(body)).not.toContain('client-supplied-token');
  });

  it('returns a minimal session DTO from trusted server resolution', async () => {
    const handler = createSessionGetHandler({
      allowedOrigins: ['https://team-tj.example.test'],
      resolveSession: async () => session,
    });
    const response = await handler(
      new Request('https://team-tj.example.test/api/session', { method: 'GET' }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      authenticated: true,
      operator: { id: 'operator_trusted', roles: ['OPERATOR'] },
      session: { id: 'session_123' },
    });
    expect(JSON.stringify(body)).not.toContain('csrf-secret-value');
  });
});
