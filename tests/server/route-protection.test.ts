import { describe, expect, it } from 'vitest';

import {
  createTrustedSessionResolver,
  toPublicOperatorSession,
  type TrustedOperatorSession,
} from '../../server/auth/session';
import { readFormDataBody, readJsonBody } from '../../server/http/request-limits';
import { InMemoryRateLimiter } from '../../server/http/rate-limit';
import { withOperatorRoute } from '../../server/http/route-protection';

const trustedSession: TrustedOperatorSession = {
  sessionId: 'session_123',
  operatorId: 'operator_trusted',
  roles: ['OPERATOR'],
  csrfToken: 'csrf-secret-value',
};

function resolverFor(session: TrustedOperatorSession | null = trustedSession) {
  return createTrustedSessionResolver({
    async lookupByToken(token) {
      return token === 'opaque-session-token' ? session : null;
    },
  });
}

function request(method: string, headers: Record<string, string> = {}, body?: BodyInit): Request {
  return new Request('https://team-tj.example.test/api/copywriter', {
    method,
    headers,
    body,
  });
}

const authenticatedHeaders = {
  cookie: 'team_tj_session=opaque-session-token',
  origin: 'https://team-tj.example.test',
  'x-csrf-token': trustedSession.csrfToken,
  'idempotency-key': 'request-123',
  'x-expected-version': '4',
  'content-type': 'application/json',
};

describe('Operator session and Route Handler protection boundary', () => {
  it('resolves Operator identity from the trusted server store, never request JSON', async () => {
    let receivedOperatorId: string | undefined;
    const handler = withOperatorRoute(
      async (_request, context) => {
        receivedOperatorId = context.operator.operatorId;
        return Response.json({ operatorId: context.operator.operatorId });
      },
      { resolveSession: resolverFor(), allowedOrigins: ['https://team-tj.example.test'] },
    );

    const response = await handler(
      request(
        'POST',
        authenticatedHeaders,
        JSON.stringify({ operatorId: 'attacker-controlled', subject: 'safe business input' }),
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(receivedOperatorId).toBe('operator_trusted');
    expect(body).toEqual({ operatorId: 'operator_trusted' });
  });

  it('rejects requests without a trusted session before invoking the handler', async () => {
    let invoked = false;
    const handler = withOperatorRoute(
      () => {
        invoked = true;
        return Response.json({ ok: true });
      },
      { resolveSession: resolverFor(null), allowedOrigins: ['https://team-tj.example.test'] },
    );

    const response = await handler(
      request('POST', authenticatedHeaders, JSON.stringify({ operatorId: 'attacker-controlled' })),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(invoked).toBe(false);
    expect(body).toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    expect(JSON.stringify(body)).not.toContain('attacker-controlled');
    expect(response.headers.get('x-trace-id')).toBe(body.traceId);
  });

  it('requires origin, CSRF token, and idempotency key for mutations', async () => {
    const handler = withOperatorRoute(() => Response.json({ ok: true }), {
      resolveSession: resolverFor(),
      allowedOrigins: ['https://team-tj.example.test'],
    });

    const noOrigin = await handler(
      request('POST', { ...authenticatedHeaders, origin: '' }, JSON.stringify({})),
    );
    expect(noOrigin.status).toBe(403);
    expect((await noOrigin.json()).code).toBe('ORIGIN_FORBIDDEN');

    const noCsrf = await handler(
      request('POST', { ...authenticatedHeaders, 'x-csrf-token': '' }, JSON.stringify({})),
    );
    expect(noCsrf.status).toBe(403);
    expect((await noCsrf.json()).code).toBe('CSRF_INVALID');

    const noIdempotency = await handler(
      request('POST', { ...authenticatedHeaders, 'idempotency-key': '' }, JSON.stringify({})),
    );
    expect(noIdempotency.status).toBe(400);
    expect((await noIdempotency.json()).code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('passes trace, expected version, and idempotency context to future handlers', async () => {
    const handler = withOperatorRoute((_request, context) => Response.json(context), {
      resolveSession: resolverFor(),
      allowedOrigins: ['https://team-tj.example.test'],
    });
    const response = await handler(
      request(
        'POST',
        { ...authenticatedHeaders, 'x-trace-id': 'trace.test:123' },
        JSON.stringify({}),
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.traceId).toBe('trace.test:123');
    expect(body.idempotencyKey).toBe('request-123');
    expect(body.expectedVersion).toBe(4);
    expect(body.operator.operatorId).toBe('operator_trusted');
    expect(response.headers.get('x-trace-id')).toBe('trace.test:123');
  });

  it('generates a trace ID when a supplied trace ID is malformed', async () => {
    const handler = withOperatorRoute(
      (_request, context) => Response.json({ traceId: context.traceId }),
      { resolveSession: resolverFor(), allowedOrigins: ['https://team-tj.example.test'] },
    );
    const response = await handler(
      request('GET', {
        cookie: 'team_tj_session=opaque-session-token',
        'x-trace-id': 'not allowed/with spaces',
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.traceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get('x-trace-id')).toBe(body.traceId);
  });

  it('enforces JSON and multipart size/content-type boundaries', async () => {
    const handler = withOperatorRoute(() => Response.json({ ok: true }), {
      resolveSession: resolverFor(),
      allowedOrigins: ['https://team-tj.example.test'],
      requestLimits: {
        maxBodyBytes: 1_000,
        maxJsonBytes: 4,
        maxFormBytes: 1_000,
        maxFileBytes: 2,
        maxFiles: 1,
        maxFormFields: 4,
      },
    });

    const oversizedJson = await handler(
      request('POST', authenticatedHeaders, JSON.stringify({ value: 'large' })),
    );
    expect(oversizedJson.status).toBe(413);
    expect((await oversizedJson.json()).code).toBe('REQUEST_BODY_TOO_LARGE');

    const unsupported = await handler(
      request('POST', { ...authenticatedHeaders, 'content-type': 'text/plain' }, 'plain text'),
    );
    expect(unsupported.status).toBe(415);
    expect((await unsupported.json()).code).toBe('UNSUPPORTED_MEDIA_TYPE');

    const form = new FormData();
    form.append('file', new Blob(['12345'], { type: 'text/plain' }), 'notes.txt');
    const multipart = await handler(
      request(
        'POST',
        {
          cookie: authenticatedHeaders.cookie,
          origin: authenticatedHeaders.origin,
          'x-csrf-token': authenticatedHeaders['x-csrf-token'],
          'idempotency-key': authenticatedHeaders['idempotency-key'],
        },
        form,
      ),
    );
    expect(multipart.status).toBe(413);
    expect((await multipart.json()).code).toBe('REQUEST_BODY_TOO_LARGE');
  });

  it('provides bounded JSON/FormData readers for handlers', async () => {
    const jsonRequest = request(
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify({ safe: true }),
    );
    await expect(readJsonBody(jsonRequest)).resolves.toEqual({ safe: true });

    const form = new FormData();
    form.set('brief', 'topic');
    const formRequest = request('POST', {}, form);
    await expect(readFormDataBody(formRequest)).resolves.toBeInstanceOf(FormData);
  });

  it('exposes only a safe session DTO and never CSRF material', () => {
    const dto = toPublicOperatorSession(trustedSession);
    expect(dto).toEqual({
      authenticated: true,
      operator: { id: 'operator_trusted', roles: ['OPERATOR'] },
      session: { id: 'session_123' },
    });
    expect(JSON.stringify(dto)).not.toContain('csrf');
    expect(JSON.stringify(dto)).not.toContain('opaque-session-token');
  });

  it('provides a reusable Operator-scoped rate-limit entry point', async () => {
    const limiter = new InMemoryRateLimiter(() => 1_000);
    const handler = withOperatorRoute(() => Response.json({ ok: true }), {
      resolveSession: resolverFor(),
      allowedOrigins: ['https://team-tj.example.test'],
      rateLimiter: limiter,
      rateLimitPolicy: { limit: 1, windowMs: 10_000 },
    });

    const first = await handler(request('GET', { cookie: authenticatedHeaders.cookie }));
    const second = await handler(request('GET', { cookie: authenticatedHeaders.cookie }));

    expect(first.status).toBe(200);
    expect(first.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(second.status).toBe(429);
    expect(second.headers.get('retry-after')).toBe('10');
    expect((await second.json()).code).toBe('RATE_LIMITED');
  });
});
