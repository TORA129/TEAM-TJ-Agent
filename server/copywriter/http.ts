import 'server-only';

import { withOperatorRoute, type RouteProtectionOptions } from '@/server/http/route-protection';
import type { RequestContext } from '@/server/http/request-context';
import { PublicApplicationError } from '@/server/public-errors';
import { safeJsonResponse } from '@/server/security/safe-dtos';
import type { UUID } from '@/domain/persistence/models';
import { getConfiguredCopywriterService, getConfiguredSupplementaryFileService } from './runtime';
import { SupplementaryFileService } from './supplementary-files';
import {
  parseClarificationInput,
  parseCopywriterCreateInput,
  parseCopywriterDraftEditInput,
  parseCopywriterDraftGenerateInput,
  parseCopywriterConfirmInput,
  parseCopywriterPatchInput,
} from './schema';
import { CopywriterService } from './service';

export type CopywriterRouteContext = {
  readonly params?: { readonly id?: unknown } | Promise<{ readonly id?: unknown }>;
};

export function createCopywriterSessionPostHandler(
  service?: CopywriterService,
  options: RouteProtectionOptions = {},
) {
  return withOperatorRoute(
    async (request, context) => {
      const input = parseCopywriterCreateInput(await readJson(request));
      const result = await (service ?? getConfiguredCopywriterService()).create({
        operatorId: context.operator.operatorId,
        request: input,
        idempotencyKey: requiredIdempotencyKey(context),
        traceId: context.traceId,
      });
      return safeJsonResponse(result, {
        status: result.created ? 201 : 200,
        headers: { 'cache-control': 'no-store' },
      });
    },
    options,
  );
}

export function createCopywriterSessionGetHandler(
  service?: CopywriterService,
  options: RouteProtectionOptions = {},
) {
  return withOperatorRoute(
    async (_request, context, routeContext) => {
      const sessionId = await readSessionId(routeContext as CopywriterRouteContext | undefined);
      const result = await (service ?? getConfiguredCopywriterService()).get({
        sessionId,
        operatorId: context.operator.operatorId,
      });
      return safeJsonResponse(result, {
        headers: { 'cache-control': 'no-store' },
      });
    },
    options,
  );
}

export function createCopywriterSessionPatchHandler(
  service?: CopywriterService,
  options: RouteProtectionOptions = {},
) {
  return withOperatorRoute(
    async (request, context, routeContext) => {
      const sessionId = await readSessionId(routeContext as CopywriterRouteContext | undefined);
      const expectedVersion = context.expectedVersion;
      if (expectedVersion === undefined) {
        throw new PublicApplicationError({
          code: 'VALIDATION_FAILED',
          fieldErrors: { expectedVersion: ['The x-expected-version header is required.'] },
        });
      }
      const input = parseCopywriterPatchInput(await readJson(request));
      const result = await (service ?? getConfiguredCopywriterService()).update({
        sessionId,
        operatorId: context.operator.operatorId,
        request: input,
        expectedVersion,
        idempotencyKey: requiredIdempotencyKey(context),
        traceId: context.traceId,
      });
      return safeJsonResponse(result, {
        headers: { 'cache-control': 'no-store' },
      });
    },
    options,
  );
}

function requiredIdempotencyKey(context: RequestContext): string {
  if (!context.idempotencyKey) {
    throw new PublicApplicationError({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
  }
  return context.idempotencyKey;
}

async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new PublicApplicationError({ code: 'UNSUPPORTED_MEDIA_TYPE' });
  }
  try {
    return await request.json();
  } catch {
    throw new PublicApplicationError({
      code: 'VALIDATION_FAILED',
      fieldErrors: { body: ['Provide valid JSON.'] },
    });
  }
}

async function readSessionId(routeContext: CopywriterRouteContext | undefined): Promise<UUID> {
  const params = routeContext?.params ? await routeContext.params : undefined;
  if (!params || typeof params.id !== 'string' || !params.id.trim()) {
    throw new PublicApplicationError({
      code: 'VALIDATION_FAILED',
      fieldErrors: { id: ['A copywriter session identifier is required.'] },
    });
  }
  return params.id;
}

export type SupplementaryFileRouteContext = {
  readonly params?: { readonly id?: unknown; readonly fileId?: unknown } | Promise<{ readonly id?: unknown; readonly fileId?: unknown }>;
};

export function createSupplementaryFileGetHandler(
  service?: SupplementaryFileService,
  options: RouteProtectionOptions = {},
) {
  return withOperatorRoute(async (_request, context, routeContext) => {
    const sessionId = await readSessionId(routeContext as CopywriterRouteContext | undefined);
    return safeJsonResponse(await (service ?? getConfiguredSupplementaryFileService()).list({ sessionId, operatorId: context.operator.operatorId }), { headers: { 'cache-control': 'no-store' } });
  }, options);
}

export function createSupplementaryFilePostHandler(
  service?: SupplementaryFileService,
  options: RouteProtectionOptions = {},
) {
  return withOperatorRoute(async (request, context, routeContext) => {
    const sessionId = await readSessionId(routeContext as CopywriterRouteContext | undefined);
    const form = await request.formData();
    const value = form.get('file');
    if (!(value instanceof File)) {
      throw new PublicApplicationError({ code: 'VALIDATION_FAILED', fieldErrors: { file: ['A file is required.'] } });
    }
    const file = await (service ?? getConfiguredSupplementaryFileService()).upload({ sessionId, operatorId: context.operator.operatorId, file: value });
    return safeJsonResponse({ file }, { status: 201, headers: { 'cache-control': 'no-store' } });
  }, options);
}

export function createSupplementaryFileActionHandler(
  service?: SupplementaryFileService,
  options: RouteProtectionOptions = {},
) {
  return withOperatorRoute(async (request, context, routeContext) => {
    const params = routeContext ? await (routeContext as SupplementaryFileRouteContext).params : undefined;
    if (!params || typeof params.id !== 'string' || typeof params.fileId !== 'string') throw new PublicApplicationError({ code: 'VALIDATION_FAILED' });
    const body = await readJson(request) as { action?: unknown };
    if (body.action !== 'CONTINUE_WITH_BRIEF' && body.action !== 'REPLACE_FILE') throw new PublicApplicationError({ code: 'VALIDATION_FAILED', fieldErrors: { action: ['Use CONTINUE_WITH_BRIEF or REPLACE_FILE.'] } });
    const file = await (service ?? getConfiguredSupplementaryFileService()).action({ sessionId: params.id, fileId: params.fileId, operatorId: context.operator.operatorId, action: body.action });
    return safeJsonResponse({ file }, { headers: { 'cache-control': 'no-store' } });
  }, options);
}

export function createCopywriterQuestionsPostHandler(
  service?: CopywriterService,
  options: RouteProtectionOptions = {},
) {
  return withOperatorRoute(
    async (request, context, routeContext) => {
      const sessionId = await readSessionId(routeContext as CopywriterRouteContext | undefined);
      const expectedVersion = context.expectedVersion;
      if (expectedVersion === undefined) {
        throw new PublicApplicationError({
          code: 'VALIDATION_FAILED',
          fieldErrors: { expectedVersion: ['The x-expected-version header is required.'] },
        });
      }
      const result = await (service ?? getConfiguredCopywriterService()).clarify({
        sessionId,
        operatorId: context.operator.operatorId,
        request: parseClarificationInput(await readJson(request)),
        expectedVersion,
        idempotencyKey: requiredIdempotencyKey(context),
        traceId: context.traceId,
      });
      return safeJsonResponse(result, { headers: { 'cache-control': 'no-store' } });
    },
    options,
  );
}


export function createCopywriterDraftGenerateHandler(service?: CopywriterService, options: RouteProtectionOptions = {}) {
  return withOperatorRoute(async (request, context, routeContext) => {
    const sessionId = await readSessionId(routeContext as CopywriterRouteContext | undefined);
    const result = await (service ?? getConfiguredCopywriterService()).generateDraft({ sessionId, operatorId: context.operator.operatorId, request: parseCopywriterDraftGenerateInput(await readJson(request)), idempotencyKey: requiredIdempotencyKey(context), traceId: context.traceId });
    return safeJsonResponse(result, { status: result.created ? 201 : 200, headers: { 'cache-control': 'no-store' } });
  }, options);
}

export function createCopywriterDraftGetHandler(service?: CopywriterService, options: RouteProtectionOptions = {}) {
  return withOperatorRoute(async (_request, context, routeContext) => {
    const sessionId = await readSessionId(routeContext as CopywriterRouteContext | undefined);
    return safeJsonResponse({ draft: await (service ?? getConfiguredCopywriterService()).getDraft({ sessionId, operatorId: context.operator.operatorId }) }, { headers: { 'cache-control': 'no-store' } });
  }, options);
}

export function createCopywriterDraftPatchHandler(service?: CopywriterService, options: RouteProtectionOptions = {}) {
  return withOperatorRoute(async (request, context, routeContext) => {
    const sessionId = await readSessionId(routeContext as CopywriterRouteContext | undefined);
    if (context.expectedVersion === undefined) throw new PublicApplicationError({ code: 'VALIDATION_FAILED', fieldErrors: { expectedVersion: ['The x-expected-version header is required.'] } });
    const result = await (service ?? getConfiguredCopywriterService()).editDraft({ sessionId, operatorId: context.operator.operatorId, expectedVersion: context.expectedVersion, request: parseCopywriterDraftEditInput(await readJson(request)), idempotencyKey: requiredIdempotencyKey(context), traceId: context.traceId });
    return safeJsonResponse(result, { headers: { 'cache-control': 'no-store' } });
  }, options);
}

export function createCopywriterConfirmHandler(service?: CopywriterService, options: RouteProtectionOptions = {}) {
  return withOperatorRoute(async (request, context, routeContext) => {
    const sessionId = await readSessionId(routeContext as CopywriterRouteContext | undefined);
    const input = parseCopywriterConfirmInput(await readJson(request));
    const version = input.version ?? context.expectedVersion;
    if (version === undefined) throw new PublicApplicationError({ code: 'VALIDATION_FAILED', fieldErrors: { version: ['A draft version is required in the body or x-expected-version header.'] } });
    const result = await (service ?? getConfiguredCopywriterService()).confirmDraft({ sessionId, operatorId: context.operator.operatorId, version, idempotencyKey: requiredIdempotencyKey(context), traceId: context.traceId });
    return safeJsonResponse(result, { headers: { 'cache-control': 'no-store' } });
  }, options);
}


import { getConfiguredCoverService } from './runtime';
import { parseCoverGenerateInput, parseCoverPatchInput } from './schema';
import { CoverService } from './cover-service';

export function createCopywriterCoverGetHandler(service?: CoverService, options: RouteProtectionOptions = {}) {
  return withOperatorRoute(async (_request, context, routeContext) => {
    const sessionId = await readSessionId(routeContext as CopywriterRouteContext | undefined);
    return safeJsonResponse(await (service ?? getConfiguredCoverService()).detail({ sessionId, operatorId: context.operator.operatorId }), { headers: { 'cache-control': 'no-store' } });
  }, options);
}

export function createCopywriterCoverGenerateHandler(service?: CoverService, options: RouteProtectionOptions = {}) {
  return withOperatorRoute(async (request, context, routeContext) => {
    const sessionId = await readSessionId(routeContext as CopywriterRouteContext | undefined);
    return safeJsonResponse(await (service ?? getConfiguredCoverService()).generate({ sessionId, operatorId: context.operator.operatorId, request: parseCoverGenerateInput(await readJson(request)) }), { status: 201, headers: { 'cache-control': 'no-store' } });
  }, options);
}

export function createCopywriterCoverUploadHandler(service?: CoverService, options: RouteProtectionOptions = {}) {
  return withOperatorRoute(async (request, context, routeContext) => {
    const sessionId = await readSessionId(routeContext as CopywriterRouteContext | undefined);
    const form = await request.formData();
    const file = form.get('file');
    const reason = form.get('reason');
    if (!(file instanceof File) || typeof reason !== 'string' || !reason.trim()) throw new PublicApplicationError({ code: 'VALIDATION_FAILED', fieldErrors: { file: ['A file and replacement reason are required.'] } });
    return safeJsonResponse(await (service ?? getConfiguredCoverService()).upload({ sessionId, operatorId: context.operator.operatorId, file, reason }), { status: 201, headers: { 'cache-control': 'no-store' } });
  }, options);
}

export function createCopywriterCoverPatchHandler(service?: CoverService, options: RouteProtectionOptions = {}) {
  return withOperatorRoute(async (request, context, routeContext) => {
    const sessionId = await readSessionId(routeContext as CopywriterRouteContext | undefined);
    return safeJsonResponse(await (service ?? getConfiguredCoverService()).patch({ sessionId, operatorId: context.operator.operatorId, request: parseCoverPatchInput(await readJson(request)) }), { headers: { 'cache-control': 'no-store' } });
  }, options);
}
