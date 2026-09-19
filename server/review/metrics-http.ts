import 'server-only';
import { withOperatorRoute, type RouteProtectionOptions } from '@/server/http/route-protection';
import type { RequestContext } from '@/server/http/request-context';
import { PublicApplicationError } from '@/server/public-errors';
import { safeJsonResponse } from '@/server/security/safe-dtos';
import { getConfiguredReviewMetricsService } from './metrics-runtime';
import { parseEvaluationInput, parseMetricPatchInput, parseThresholdPatchInput, validateRouteId } from './schema';
import type { ReviewMetricsService } from './metrics-service';

type RouteContext = { params?: { id?: unknown } | Promise<{ id?: unknown }> };
async function id(routeContext?: RouteContext): Promise<string> { const params = routeContext?.params ? await routeContext.params : undefined; return validateRouteId(params?.id); }
async function json(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new PublicApplicationError({ code: 'UNSUPPORTED_MEDIA_TYPE' });
  try { return await request.json(); } catch { throw new PublicApplicationError({ code: 'VALIDATION_FAILED', fieldErrors: { body: ['Provide valid JSON.'] } }); }
}
function key(context: RequestContext): string { if (!context.idempotencyKey) throw new PublicApplicationError({ code: 'IDEMPOTENCY_KEY_REQUIRED' }); return context.idempotencyKey; }
function expected(context: RequestContext): number { if (context.expectedVersion === undefined) throw new PublicApplicationError({ code: 'VALIDATION_FAILED', fieldErrors: { expectedVersion: ['The x-expected-version header is required.'] } }); return context.expectedVersion; }

export function createReviewMetricsGetHandler(service?: ReviewMetricsService, options: RouteProtectionOptions = {}) { return withOperatorRoute(async (_request, context, routeContext) => safeJsonResponse(await (service ?? getConfiguredReviewMetricsService()).getMetrics({ reviewId: await id(routeContext as RouteContext), operatorId: context.operator.operatorId }), { headers: { 'cache-control': 'no-store' } }), { ...options, requireIdempotencyKey: false }); }
export function createReviewMetricsPatchHandler(service?: ReviewMetricsService, options: RouteProtectionOptions = {}) { return withOperatorRoute(async (request, context, routeContext) => safeJsonResponse(await (service ?? getConfiguredReviewMetricsService()).patchMetrics({ reviewId: await id(routeContext as RouteContext), operatorId: context.operator.operatorId, request: parseMetricPatchInput(await json(request)), expectedVersion: expected(context), idempotencyKey: key(context), traceId: context.traceId }), { headers: { 'cache-control': 'no-store' } }), options); }
export function createReviewThresholdsGetHandler(service?: ReviewMetricsService, options: RouteProtectionOptions = {}) { return withOperatorRoute(async (_request, context, routeContext) => { await id(routeContext as RouteContext); return safeJsonResponse(await (service ?? getConfiguredReviewMetricsService()).getThresholds({ operatorId: context.operator.operatorId }), { headers: { 'cache-control': 'no-store' } }); }, { ...options, requireIdempotencyKey: false }); }
export function createReviewThresholdsPatchHandler(service?: ReviewMetricsService, options: RouteProtectionOptions = {}) { return withOperatorRoute(async (request, context, routeContext) => { await id(routeContext as RouteContext); return safeJsonResponse(await (service ?? getConfiguredReviewMetricsService()).patchThresholds({ operatorId: context.operator.operatorId, request: parseThresholdPatchInput(await json(request)), expectedVersion: expected(context), idempotencyKey: key(context), traceId: context.traceId }), { headers: { 'cache-control': 'no-store' } }); }, options); }

export function createReviewEvaluationPostHandler(service?: ReviewMetricsService, options: RouteProtectionOptions = {}) {
  return withOperatorRoute(async (request, context, routeContext) => safeJsonResponse(
    await (service ?? getConfiguredReviewMetricsService()).evaluate({
      reviewId: await id(routeContext as RouteContext),
      operatorId: context.operator.operatorId,
      expectedVersion: expected(context),
      traceId: context.traceId,
      ...parseEvaluationInput(await json(request)),
    }),
    { headers: { 'cache-control': 'no-store' } },
  ), options);
}
