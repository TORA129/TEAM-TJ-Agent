import { describe, expect, it } from 'vitest';

import { createRequestContext } from '../../server/http/request-context';
import type { TrustedOperatorSession } from '../../server/auth/session';

const session: TrustedOperatorSession = {
  sessionId: 'session_123',
  operatorId: 'operator_trusted',
  roles: ['OPERATOR'],
  csrfToken: 'csrf-secret-value',
};

describe('request context', () => {
  it('rejects malformed version and idempotency headers without exposing input values', () => {
    const request = new Request('https://team-tj.example.test/api', {
      method: 'POST',
      headers: {
        'idempotency-key': 'bad key',
        'x-expected-version': 'v4',
      },
    });

    expect(() => createRequestContext(request, session)).toThrow('The request context is invalid.');
  });

  it('allows read requests without mutation-only headers', () => {
    const request = new Request('https://team-tj.example.test/api', { method: 'GET' });
    const context = createRequestContext(request, session);

    expect(context.method).toBe('GET');
    expect(context.operator.operatorId).toBe('operator_trusted');
    expect(context.idempotencyKey).toBeUndefined();
    expect(context.expectedVersion).toBeUndefined();
  });
});
