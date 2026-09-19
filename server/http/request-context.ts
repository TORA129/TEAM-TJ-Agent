import 'server-only';

import { randomUUID } from 'node:crypto';

import type { TrustedOperatorSession } from '@/server/auth/session';
import { RouteGuardError } from './errors';

const TRACE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;
const MAX_EXPECTED_VERSION = 2_147_483_647;

export type RequestContext = {
  readonly traceId: string;
  readonly method: string;
  readonly url: string;
  readonly session: TrustedOperatorSession;
  readonly operator: {
    readonly operatorId: string;
    readonly roles: readonly TrustedOperatorSession['roles'][number][];
  };
  readonly idempotencyKey?: string;
  readonly expectedVersion?: number;
};

export function isMutationMethod(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

export function createTraceId(request: Request): string {
  const supplied = request.headers.get('x-trace-id')?.trim();
  return supplied && TRACE_ID_PATTERN.test(supplied) ? supplied : randomUUID();
}

function readIdempotencyKey(request: Request): string | undefined {
  const value = request.headers.get('idempotency-key')?.trim();
  if (!value) return undefined;
  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new RouteGuardError({
      status: 400,
      code: 'REQUEST_CONTEXT_INVALID',
      message: 'The request context is invalid.',
      action: 'Use a valid idempotency key.',
      fieldErrors: { idempotencyKey: ['Use 1-200 letters, numbers, or . _ : - characters.'] },
    });
  }
  return value;
}

function readExpectedVersion(request: Request): number | undefined {
  const value = request.headers.get('x-expected-version')?.trim();
  if (!value) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new RouteGuardError({
      status: 400,
      code: 'REQUEST_CONTEXT_INVALID',
      message: 'The request context is invalid.',
      action: 'Use a non-negative integer expected version.',
      fieldErrors: { expectedVersion: ['Expected a non-negative integer.'] },
    });
  }
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version > MAX_EXPECTED_VERSION) {
    throw new RouteGuardError({
      status: 400,
      code: 'REQUEST_CONTEXT_INVALID',
      message: 'The request context is invalid.',
      action: 'Use a valid expected version.',
      fieldErrors: { expectedVersion: ['Expected a safe integer version.'] },
    });
  }
  return version;
}

export function createRequestContext(
  request: Request,
  session: TrustedOperatorSession,
  options: { readonly requireIdempotencyKey?: boolean; readonly traceId?: string } = {},
): RequestContext {
  const method = request.method.toUpperCase();
  const idempotencyKey = readIdempotencyKey(request);
  if (isMutationMethod(method) && (options.requireIdempotencyKey ?? true) && !idempotencyKey) {
    throw new RouteGuardError({
      status: 400,
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: 'An idempotency key is required for this write request.',
      action: 'Retry with a unique Idempotency-Key header.',
      fieldErrors: { idempotencyKey: ['This header is required for write requests.'] },
    });
  }

  const traceId = options.traceId ?? createTraceId(request);
  const expectedVersion = readExpectedVersion(request);
  return {
    traceId,
    method,
    url: request.url,
    session,
    operator: {
      operatorId: session.operatorId,
      roles: [...session.roles],
    },
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
  };
}
