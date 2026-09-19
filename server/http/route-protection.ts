import 'server-only';

import { timingSafeEqual } from 'node:crypto';

import {
  resolveTrustedOperatorSession,
  type TrustedOperatorSession,
  type TrustedSessionResolver,
} from '@/server/auth/session';
import { RouteGuardError, routeErrorResponse } from './errors';
import {
  createRequestContext,
  createTraceId,
  isMutationMethod,
  type RequestContext,
} from './request-context';
import {
  assertRequestBodyLimits,
  DEFAULT_REQUEST_LIMITS,
  type RequestLimits,
} from './request-limits';
import {
  defaultRateLimiter,
  enforceRateLimit,
  operatorRateLimitKey,
  type RateLimiter,
  type RateLimitPolicy,
} from './rate-limit';

export type ProtectedRouteHandler = (
  request: Request,
  context: RequestContext,
  routeContext?: unknown,
) => Response | Promise<Response>;

export type RouteProtectionOptions = {
  readonly resolveSession?: TrustedSessionResolver;
  readonly allowedOrigins?: readonly string[];
  readonly requestLimits?: RequestLimits;
  readonly rateLimiter?: RateLimiter;
  readonly rateLimitPolicy?: RateLimitPolicy;
  readonly requireIdempotencyKey?: boolean;
};

const DEFAULT_RATE_LIMIT_POLICY: RateLimitPolicy = { limit: 60, windowMs: 60_000 };

function normalizedOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function configuredOrigins(options: RouteProtectionOptions): readonly string[] {
  if (options.allowedOrigins) {
    return options.allowedOrigins
      .map(normalizedOrigin)
      .filter((value): value is string => value !== null);
  }
  const configured = process.env.APP_URL;
  const origin = configured ? normalizedOrigin(configured) : null;
  return origin ? [origin] : [];
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function assertOriginAndCsrf(
  request: Request,
  session: TrustedOperatorSession,
  options: RouteProtectionOptions,
): void {
  if (!isMutationMethod(request.method.toUpperCase())) return;

  const origin = request.headers.get('origin');
  const allowedOrigins = configuredOrigins(options);
  if (!origin || !allowedOrigins.includes(normalizedOrigin(origin) ?? '')) {
    throw new RouteGuardError({
      status: 403,
      code: 'ORIGIN_FORBIDDEN',
      message: 'The request origin is not allowed.',
      action: 'Retry from the configured Team-TJ application origin.',
    });
  }

  const csrfToken = request.headers.get('x-csrf-token')?.trim();
  if (!csrfToken || !constantTimeEqual(csrfToken, session.csrfToken)) {
    throw new RouteGuardError({
      status: 403,
      code: 'CSRF_INVALID',
      message: 'The request could not be verified.',
      action: 'Refresh the session and retry the request.',
    });
  }
}

function withTraceHeader(response: Response, traceId: string): Response {
  response.headers.set('x-trace-id', traceId);
  return response;
}

export function withOperatorRoute(
  handler: ProtectedRouteHandler,
  options: RouteProtectionOptions = {},
): (request: Request, routeContext?: unknown) => Promise<Response> {
  return async (request, routeContext) => {
    const traceId = createTraceId(request);
    try {
      const resolveSession = options.resolveSession ?? resolveTrustedOperatorSession;
      const session = await resolveSession(request);
      if (!session) {
        throw new RouteGuardError({
          status: 401,
          code: 'AUTHENTICATION_REQUIRED',
          message: 'An authenticated Operator session is required.',
          action: 'Sign in and retry the request.',
        });
      }

      assertOriginAndCsrf(request, session, options);
      await assertRequestBodyLimits(request, options.requestLimits ?? DEFAULT_REQUEST_LIMITS);
      const context = createRequestContext(request, session, {
        requireIdempotencyKey: options.requireIdempotencyKey,
        traceId,
      });
      const decision = await enforceRateLimit(
        options.rateLimiter ?? defaultRateLimiter,
        operatorRateLimitKey(session.operatorId),
        options.rateLimitPolicy ?? DEFAULT_RATE_LIMIT_POLICY,
      );
      const response = await handler(request, context, routeContext);
      response.headers.set('x-ratelimit-remaining', String(decision.remaining));
      return withTraceHeader(response, traceId);
    } catch (error) {
      return routeErrorResponse(error, traceId);
    }
  };
}
