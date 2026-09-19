import 'server-only';

import { withOperatorRoute, type RouteProtectionOptions } from '@/server/http/route-protection';
import { PublicApplicationError } from '@/server/public-errors';
import { safeJsonResponse } from '@/server/security/safe-dtos';
import { getConfiguredBlockedTermListService } from './blocked-terms-runtime';
import {
  parseBlockedTermListCreateInput,
  parseBlockedTermListId,
  parseBlockedTermListPatchInput,
} from './blocked-terms-schema';
import { BlockedTermListService } from './blocked-terms-service';

export type BlockedTermRouteContext = {
  readonly params?: { readonly id?: unknown } | Promise<{ readonly id?: unknown }>;
};

export function createBlockedTermListGetHandler(
  service?: BlockedTermListService,
  options: RouteProtectionOptions = {},
) {
  return withOperatorRoute(
    async (request, context, routeContext) => {
      const id = await readId(routeContext as BlockedTermRouteContext | undefined);
      const result = id
        ? await (service ?? getConfiguredBlockedTermListService()).get({
            operatorId: context.operator.operatorId,
            id,
          })
        : await (service ?? getConfiguredBlockedTermListService()).list({
            operatorId: context.operator.operatorId,
            name: new URL(request.url).searchParams.get('name') ?? undefined,
          });
      return safeJsonResponse(result, { headers: { 'cache-control': 'no-store' } });
    },
    { ...options, requireIdempotencyKey: false },
  );
}

export function createBlockedTermListPostHandler(
  service?: BlockedTermListService,
  options: RouteProtectionOptions = {},
) {
  return withOperatorRoute(async (request, context) => {
    const input = parseBlockedTermListCreateInput(await readBody(request));
    const result = await (service ?? getConfiguredBlockedTermListService()).create({
      operatorId: context.operator.operatorId,
      request: input,
      traceId: context.traceId,
      idempotencyKey: requiredIdempotencyKey(context),
    });
    return safeJsonResponse(result, {
      status: result.created ? 201 : 200,
      headers: { 'cache-control': 'no-store' },
    });
  }, options);
}

export function createBlockedTermListPatchHandler(
  service?: BlockedTermListService,
  options: RouteProtectionOptions = {},
) {
  return withOperatorRoute(async (request, context, routeContext) => {
    const id = await readId(routeContext as BlockedTermRouteContext | undefined);
    const expectedVersion = requiredExpectedVersion(context.expectedVersion);
    if (!id) {
      throw new PublicApplicationError({
        code: 'VALIDATION_FAILED',
        fieldErrors: { id: ['A list identifier is required.'] },
      });
    }
    const input = parseBlockedTermListPatchInput(await readBody(request), id);
    const result = await (service ?? getConfiguredBlockedTermListService()).update({
      operatorId: context.operator.operatorId,
      request: input,
      expectedVersion,
      traceId: context.traceId,
      idempotencyKey: requiredIdempotencyKey(context),
    });
    return safeJsonResponse(result, { headers: { 'cache-control': 'no-store' } });
  }, options);
}

export function createBlockedTermListDeleteHandler(
  service?: BlockedTermListService,
  options: RouteProtectionOptions = {},
) {
  return withOperatorRoute(async (_request, context, routeContext) => {
    const id = await readId(routeContext as BlockedTermRouteContext | undefined);
    const expectedVersion = requiredExpectedVersion(context.expectedVersion);
    if (!id) {
      throw new PublicApplicationError({
        code: 'VALIDATION_FAILED',
        fieldErrors: { id: ['A list identifier is required.'] },
      });
    }
    const result = await (service ?? getConfiguredBlockedTermListService()).archive({
      operatorId: context.operator.operatorId,
      id,
      expectedVersion,
      traceId: context.traceId,
      idempotencyKey: requiredIdempotencyKey(context),
    });
    return safeJsonResponse(result, { headers: { 'cache-control': 'no-store' } });
  }, options);
}

function requiredIdempotencyKey(context: { readonly idempotencyKey?: string }): string {
  if (!context.idempotencyKey)
    throw new PublicApplicationError({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
  return context.idempotencyKey;
}

function requiredExpectedVersion(value: number | undefined): number {
  if (value === undefined)
    throw new PublicApplicationError({
      code: 'VALIDATION_FAILED',
      fieldErrors: { expectedVersion: ['The x-expected-version header is required.'] },
    });
  return value;
}

async function readId(
  routeContext: BlockedTermRouteContext | undefined,
): Promise<string | undefined> {
  const params = routeContext?.params ? await routeContext.params : undefined;
  if (params?.id === undefined) return undefined;
  if (typeof params.id !== 'string')
    throw new PublicApplicationError({
      code: 'VALIDATION_FAILED',
      fieldErrors: { id: ['A list identifier is required.'] },
    });
  return parseBlockedTermListId(params.id);
}

async function readBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json')
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
