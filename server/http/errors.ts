import 'server-only';

import { safeJsonResponse } from '../security/safe-dtos';
import {
  PublicApplicationError,
  type PublicErrorDTO,
  type PublicErrorCode,
  toPublicErrorDTO,
} from '../public-errors';

export {
  getPublicErrorPolicy,
  getRetryFallbackMetadata,
  isPublicErrorCode,
  PUBLIC_ERROR_POLICIES,
  redactPublicText,
  redactSensitiveValue,
  toPublicApplicationError,
  toPublicErrorDTO,
} from '../public-errors';
export type {
  PublicErrorAction,
  PublicErrorContext,
  PublicErrorDTO,
  PublicErrorPolicy,
  PublicFieldErrors,
  PublicErrorCode,
  RetryFallbackMetadata,
} from '../public-errors';

export type RouteErrorCode = Extract<
  PublicErrorCode,
  | 'AUTHENTICATION_REQUIRED'
  | 'ORIGIN_FORBIDDEN'
  | 'CSRF_INVALID'
  | 'REQUEST_BODY_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'REQUEST_CONTEXT_INVALID'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'RATE_LIMITED'
  | 'REQUEST_INVALID'
  | 'INTERNAL_ERROR'
>;

export type PublicRouteError = PublicErrorDTO;

export class RouteGuardError extends PublicApplicationError {
  constructor(options: {
    readonly status: number;
    readonly code: RouteErrorCode;
    /** Retained for call-site compatibility; public text always comes from the catalog. */
    readonly message?: string;
    /** Retained for call-site compatibility; public action always comes from the catalog. */
    readonly action?: string;
    readonly retryable?: boolean;
    readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
    readonly currentVersion?: number;
    readonly sourceRecordId?: string;
    readonly traceId?: string;
    readonly retryAfterSeconds?: number;
  }) {
    super(options);
    this.name = 'RouteGuardError';
  }
}

export function routeErrorResponse(error: unknown, traceId: string): Response {
  const routeError =
    error instanceof RouteGuardError || error instanceof PublicApplicationError
      ? error
      : new RouteGuardError({
          status: 500,
          code: 'INTERNAL_ERROR',
          traceId,
        });
  const body = toPublicErrorDTO(routeError, { traceId });
  const headers = new Headers({ 'content-type': 'application/json' });
  headers.set('x-trace-id', body.traceId);
  if (routeError.retryAfterSeconds !== undefined) {
    headers.set('retry-after', String(routeError.retryAfterSeconds));
  }

  return safeJsonResponse(body, { status: routeError.status, headers });
}
