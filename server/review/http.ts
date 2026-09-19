import { withOperatorRoute, type RouteProtectionOptions } from '@/server/http/route-protection';
import type { RequestContext } from '@/server/http/request-context';
import { PublicApplicationError } from '@/server/public-errors';
import { safeJsonResponse } from '@/server/security/safe-dtos';
import { getConfiguredReviewService } from './runtime';
import { getConfiguredReviewInsightService } from './insight-runtime';
import type { ReviewInsightService } from './insight-service';
import {
  parseAuthorizationConfirmationInput,
  parseInsightCheckInput,
  parseInsightSaveInput,
  parseReviewCreateInput,
  parseReviewFetchInput,
  parseReviewManualInput,
  validateRouteId,
} from './schema';
import { ReviewService } from './service';

type RouteContext = { params?: { id?: unknown } | Promise<{ id?: unknown }> };
const key = (context: RequestContext) => {
  if (!context.idempotencyKey)
    throw new PublicApplicationError({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
  return context.idempotencyKey;
};
async function json(request: Request): Promise<unknown> {
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
  )
    throw new PublicApplicationError({ code: 'UNSUPPORTED_MEDIA_TYPE' });
  try {
    return await request.json();
  } catch {
    throw new PublicApplicationError({
      code: 'VALIDATION_FAILED',
      fieldErrors: { body: ['Provide valid JSON.'] },
    });
  }
}
async function id(routeContext?: RouteContext): Promise<string> {
  const params = routeContext?.params ? await routeContext.params : undefined;
  return validateRouteId(params?.id);
}

export function createReviewPostHandler(
  service?: ReviewService,
  options: RouteProtectionOptions = {},
) {
  return withOperatorRoute(async (request, context) => {
    const result = await (service ?? getConfiguredReviewService()).create({
      operatorId: context.operator.operatorId,
      request: parseReviewCreateInput(await json(request)),
      idempotencyKey: key(context),
      traceId: context.traceId,
    });
    return safeJsonResponse(result, {
      status: result.created ? 201 : 200,
      headers: { 'cache-control': 'no-store' },
    });
  }, options);
}
export function createReviewGetHandler(
  service?: ReviewService,
  options: RouteProtectionOptions = {},
) {
  return withOperatorRoute(
    async (_request, context, routeContext) =>
      safeJsonResponse(
        await (service ?? getConfiguredReviewService()).get({
          reviewId: await id(routeContext as RouteContext),
          operatorId: context.operator.operatorId,
        }),
        { headers: { 'cache-control': 'no-store' } },
      ),
    options,
  );
}
export function createManualContentPostHandler(
  service?: ReviewService,
  options: RouteProtectionOptions = {},
) {
  return withOperatorRoute(async (request, context, routeContext) => {
    const result = await (service ?? getConfiguredReviewService()).appendManual({
      reviewId: await id(routeContext as RouteContext),
      operatorId: context.operator.operatorId,
      request: parseReviewManualInput(await json(request)),
      expectedVersion: context.expectedVersion ?? 0,
      idempotencyKey: key(context),
      traceId: context.traceId,
    });
    return safeJsonResponse(result, {
      status: result.created ? 201 : 200,
      headers: { 'cache-control': 'no-store' },
    });
  }, options);
}

export function createReviewFetchPostHandler(
  service?: ReviewService,
  options: RouteProtectionOptions = {},
) {
  return withOperatorRoute(async (request, context, routeContext) => {
    const result = await (service ?? getConfiguredReviewService()).fetch({
      reviewId: await id(routeContext as RouteContext),
      operatorId: context.operator.operatorId,
      request: parseReviewFetchInput(await json(request)),
      expectedVersion: context.expectedVersion ?? 0,
      idempotencyKey: key(context),
      traceId: context.traceId,
    });
    return safeJsonResponse(
      { accepted: true, jobId: result.job.id, status: result.job.status, phase: result.job.phase, pollUrl: `/api/jobs/${encodeURIComponent(result.job.id)}`, created: result.created },
      { status: result.created ? 202 : 200, headers: { 'cache-control': 'no-store', location: `/api/jobs/${encodeURIComponent(result.job.id)}` } },
    );
  }, { ...options, requireIdempotencyKey: true });
}

export function createAuthorizationPatchHandler(
  service?: ReviewService,
  options: RouteProtectionOptions = {},
) {
  return withOperatorRoute(
    async (request, context, routeContext) => {
      const result = await (service ?? getConfiguredReviewService()).confirmAuthorization({
        reviewId: await id(routeContext as RouteContext),
        operatorId: context.operator.operatorId,
        request: parseAuthorizationConfirmationInput(await json(request)),
        expectedVersion: context.expectedVersion ?? 0,
        idempotencyKey: key(context),
        traceId: context.traceId,
      });
      return safeJsonResponse(result, {
        status: result.created ? 201 : 200,
        headers: { 'cache-control': 'no-store' },
      });
    },
    { ...options, requireIdempotencyKey: true },
  );
}

export function createInsightListGetHandler(service?: ReviewInsightService, options: RouteProtectionOptions = {}) {
  return withOperatorRoute(async (request, context) => {
    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 100);
    return safeJsonResponse(await (service ?? getConfiguredReviewInsightService()).list({ operatorId: context.operator.operatorId, page: { limit: Number.isFinite(limit) && limit > 0 ? limit : 50 } }), { headers: { 'cache-control': 'no-store' } });
  }, options);
}

export function createInsightArchiveHandler(service?: ReviewInsightService, options: RouteProtectionOptions = {}) {
  return withOperatorRoute(async (request, context, routeContext) => {
    const memoryId = await id(routeContext as RouteContext);
    const body = await json(request) as { expectedVersion?: unknown };
    if (!Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion as number) < 1) throw new PublicApplicationError({ code: 'VALIDATION_FAILED', fieldErrors: { expectedVersion: ['A positive expectedVersion is required.'] } });
    return safeJsonResponse(await (service ?? getConfiguredReviewInsightService()).archive({ operatorId: context.operator.operatorId, memoryId, expectedVersion: body.expectedVersion as number, traceId: context.traceId }), { headers: { 'cache-control': 'no-store' } });
  }, { ...options, requireIdempotencyKey: false });
}

export function createInsightReferencesGetHandler(service?: ReviewInsightService, options: RouteProtectionOptions = {}) {
  return withOperatorRoute(async (request, context) => {
    const memoryIds = new URL(request.url).searchParams.getAll('id');
    return safeJsonResponse(await (service ?? getConfiguredReviewInsightService()).references({ operatorId: context.operator.operatorId, memoryIds }), { headers: { 'cache-control': 'no-store' } });
  }, options);
}
export function createInsightCheckPostHandler(service?: ReviewInsightService, options: RouteProtectionOptions = {}) {
  return withOperatorRoute(async (request, context, routeContext) => {
    const result = await (service ?? getConfiguredReviewInsightService()).check({
      reviewId: await id(routeContext as RouteContext),
      operatorId: context.operator.operatorId,
      request: parseInsightCheckInput(await json(request)),
    });
    return safeJsonResponse(result, { headers: { 'cache-control': 'no-store' } });
  }, { ...options, requireIdempotencyKey: false });
}

export function createInsightSavePostHandler(service?: ReviewInsightService, options: RouteProtectionOptions = {}) {
  return withOperatorRoute(async (request, context, routeContext) => {
    const result = await (service ?? getConfiguredReviewInsightService()).save({
      reviewId: await id(routeContext as RouteContext),
      operatorId: context.operator.operatorId,
      request: parseInsightSaveInput(await json(request)),
      traceId: context.traceId,
    });
    return safeJsonResponse(result, { status: 201, headers: { 'cache-control': 'no-store' } });
  }, { ...options, requireIdempotencyKey: true });
}
