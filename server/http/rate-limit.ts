import 'server-only';

import { RouteGuardError } from './errors';

export type RateLimitPolicy = {
  readonly limit: number;
  readonly windowMs: number;
};

export type RateLimitDecision = {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds?: number;
};

export interface RateLimiter {
  consume(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision>;
}

type WindowState = { count: number; windowStartedAt: number };

/** A small process-local fallback. Production should provide a durable store. */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, WindowState>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  async consume(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision> {
    if (!key || !Number.isSafeInteger(policy.limit) || policy.limit < 1 || policy.windowMs < 1) {
      throw new Error('Invalid rate-limit policy');
    }

    const now = this.now();
    const current = this.windows.get(key);
    const state =
      !current || now - current.windowStartedAt >= policy.windowMs
        ? { count: 0, windowStartedAt: now }
        : current;
    state.count += 1;
    this.windows.set(key, state);

    if (state.count > policy.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((policy.windowMs - (now - state.windowStartedAt)) / 1000),
        ),
      };
    }
    return { allowed: true, remaining: policy.limit - state.count };
  }
}

export const defaultRateLimiter = new InMemoryRateLimiter();

export function operatorRateLimitKey(operatorId: string): string {
  return `operator:${operatorId}`;
}

export async function enforceRateLimit(
  limiter: RateLimiter,
  key: string,
  policy: RateLimitPolicy,
): Promise<RateLimitDecision> {
  const decision = await limiter.consume(key, policy);
  if (!decision.allowed) {
    throw new RouteGuardError({
      status: 429,
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please try again later.',
      action: 'Wait before retrying the request.',
      retryable: true,
      retryAfterSeconds: decision.retryAfterSeconds,
    });
  }
  return decision;
}
