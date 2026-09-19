import 'server-only';

import type { AccessibleContent, JsonObject, UUID } from '@/domain/persistence/models';
import { PublicApplicationError } from '@/server/public-errors';
import type { ServerConfiguration } from '@/server/config';
import {
  assertGatewayElapsedTime,
  assertGatewayRedirectCount,
  assertGatewayResponseSize,
  assertSafeGatewayUrl,
  normalizeOfficialNoteUrl,
  type DnsLookup,
} from './url-security';
import { toSafeOpenCliResponse } from '@/server/security/safe-dtos';

export type OpenCliGatewayRequest = Readonly<{
  reviewId: UUID;
  authorizationId: UUID;
  exactNoteUrl: string;
}>;

type GatewayRequest = OpenCliGatewayRequest;

type GatewayContent = Readonly<{
  contentType: string;
  title?: string;
  body?: string;
  coverReference?: string;
  observedMetrics?: JsonObject;
  platformLimitations?: readonly string[];
}>;

type GatewayResponse = Readonly<{
  status: 'ok' | 'error';
  content?: GatewayContent;
  error?:
    | 'AUTHORIZATION_REQUIRED'
    | 'NON_PUBLIC'
    | 'PLATFORM_BLOCKED'
    | 'TOOL_UNAVAILABLE'
    | 'TIMEOUT';
}>;

export type OpenCliFetchResult =
  | Readonly<{
      kind: 'success';
      content: Omit<
        AccessibleContent,
        'id' | 'createdAt' | 'createdBy' | 'sourceRecordId' | 'rawHash'
      >;
    }>
  | Readonly<{ kind: 'failure'; code: GatewayResponse['error'] }>;

export interface OpenCliGatewayAdapter {
  fetch(input: GatewayRequest): Promise<OpenCliFetchResult>;
}

const MAX_BODY = 100_000;
const MAX_REFERENCE = 2_000;
const ALLOWED_ERRORS = new Set<NonNullable<GatewayResponse['error']>>([
  'AUTHORIZATION_REQUIRED',
  'NON_PUBLIC',
  'PLATFORM_BLOCKED',
  'TOOL_UNAVAILABLE',
  'TIMEOUT',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length <= max ? value : undefined;
}

function jsonObject(value: unknown): JsonObject {
  if (!isRecord(value)) return {};
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      (typeof item === 'string' && item.length <= 1_000) ||
      typeof item === 'number' ||
      typeof item === 'boolean' ||
      item === null
    )
      result[key] = item;
  }
  return result;
}

function normalizeResponse(value: unknown): GatewayResponse {
  if (!isRecord(value) || (value.status !== 'ok' && value.status !== 'error'))
    throw new PublicApplicationError({ code: 'OPENCLI_FORBIDDEN' });
  if (value.status === 'error') {
    const error = value.error;
    if (
      typeof error !== 'string' ||
      !ALLOWED_ERRORS.has(error as NonNullable<GatewayResponse['error']>)
    )
      throw new PublicApplicationError({ code: 'OPENCLI_FORBIDDEN' });
    return { status: 'error', error: error as NonNullable<GatewayResponse['error']> };
  }
  if (!isRecord(value.content) || !text(value.content.contentType, 80))
    throw new PublicApplicationError({ code: 'OPENCLI_FORBIDDEN' });
  const content = value.content;
  const title = text(content.title, 1_000);
  const body = text(content.body, MAX_BODY);
  const coverReference = text(content.coverReference, MAX_REFERENCE);
  if (!title && !body && !coverReference)
    throw new PublicApplicationError({ code: 'OPENCLI_FORBIDDEN' });
  return {
    status: 'ok',
    content: {
      contentType: content.contentType as string,
      ...(title ? { title } : {}),
      ...(body ? { body } : {}),
      ...(coverReference ? { coverReference } : {}),
      observedMetrics: jsonObject(content.observedMetrics),
      platformLimitations: Array.isArray(content.platformLimitations)
        ? content.platformLimitations
            .filter((item): item is string => typeof item === 'string' && item.length <= 500)
            .slice(0, 20)
        : [],
    },
  };
}

export class HttpOpenCliGatewayAdapter implements OpenCliGatewayAdapter {
  constructor(
    private readonly config: Pick<ServerConfiguration, 'openCli'>,
    private readonly request: typeof fetch = fetch,
    private readonly lookup?: DnsLookup,
  ) {}

  async fetch(input: GatewayRequest): Promise<OpenCliFetchResult> {
    const { gatewayUrl, gatewayToken, timeoutMs } = this.config.openCli;
    if (!gatewayUrl || !gatewayToken)
      throw new PublicApplicationError({ code: 'OPENCLI_NOT_CONFIGURED' });
    let safeGatewayUrl: URL;
    try {
      safeGatewayUrl = await assertSafeGatewayUrl(gatewayUrl, this.lookup);
    } catch (error) {
      if (error instanceof Error && error.name === 'NoteUrlSecurityError')
        throw new PublicApplicationError({ code: 'OPENCLI_FORBIDDEN' });
      throw error;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.request(safeGatewayUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${gatewayToken}` },
        body: JSON.stringify(input),
        redirect: 'error',
      });
      if (!response.ok)
        return {
          kind: 'failure',
          code:
            response.status === 401 || response.status === 403
              ? 'AUTHORIZATION_REQUIRED'
              : 'TOOL_UNAVAILABLE',
        };
      const contentLength = response.headers.get('content-length');
      if (contentLength !== null) {
        const parsedLength = Number(contentLength);
        if (!Number.isSafeInteger(parsedLength) || parsedLength > 2_000_000)
          throw new PublicApplicationError({ code: 'OPENCLI_FORBIDDEN' });
      }
      const normalized = normalizeResponse(await response.json());
      if (normalized.status === 'error') return { kind: 'failure', code: normalized.error! };
      const content = normalized.content!;
      return {
        kind: 'success',
        content: {
          reviewId: input.reviewId,
          authorizationId: input.authorizationId,
          retrievedAt: new Date(),
          contentType: content.contentType,
          ...(content.title ? { title: content.title } : {}),
          ...(content.body ? { body: content.body } : {}),
          ...(content.coverReference ? { coverReference: content.coverReference } : {}),
          observedMetrics: content.observedMetrics ?? {},
          platformLimitations: content.platformLimitations ?? [],
        },
      };
    } catch (error) {
      if (error instanceof PublicApplicationError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError')
        return { kind: 'failure', code: 'TIMEOUT' };
      if (error instanceof Error && error.name === 'AbortError')
        return { kind: 'failure', code: 'TIMEOUT' };
      return { kind: 'failure', code: 'TOOL_UNAVAILABLE' };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function gatewayFailureToPublicError(
  code: NonNullable<GatewayResponse['error']>,
): PublicApplicationError {
  if (code === 'AUTHORIZATION_REQUIRED')
    return new PublicApplicationError({ code: 'AUTHORIZATION_REQUIRED' });
  if (code === 'NON_PUBLIC' || code === 'PLATFORM_BLOCKED')
    return new PublicApplicationError({ code: 'OPENCLI_FORBIDDEN' });
  if (code === 'TIMEOUT') return new PublicApplicationError({ code: 'OPENCLI_TIMEOUT' });
  return new PublicApplicationError({ code: 'OPENCLI_NOT_CONFIGURED' });
}

export function safeGatewayResult(result: OpenCliFetchResult): OpenCliFetchResult {
  return toSafeOpenCliResponse(result);
}

type ContractGatewayResponse = Readonly<{
  status:
    | 'SUCCESS'
    | 'AUTHORIZATION_REQUIRED'
    | 'NON_PUBLIC'
    | 'PLATFORM_BLOCKED'
    | 'TOOL_UNAVAILABLE'
    | 'TIMEOUT';
  responseBytes: number;
  elapsedMs: number;
  redirectCount?: number;
  content?: Readonly<Record<string, unknown>>;
}>;

type SafeGatewayContent = Readonly<{
  title?: string;
  body?: string;
  sourceUrl: string;
  retrievedAt?: unknown;
}>;

export function createOpenCliGatewayAdapter(
  request: (input: OpenCliGatewayRequest) => Promise<ContractGatewayResponse>,
): (input: OpenCliGatewayRequest) => Promise<SafeGatewayContent> {
  return async (input) => {
    const normalizedUrl = normalizeOfficialNoteUrl(input.exactNoteUrl);
    const response = await request({ ...input, exactNoteUrl: normalizedUrl.normalized });
    assertGatewayResponseSize(response.responseBytes);
    assertGatewayElapsedTime(response.elapsedMs);
    assertGatewayRedirectCount(response.redirectCount ?? 0);
    if (response.status !== 'SUCCESS') {
      throw gatewayFailureToPublicError(response.status);
    }
    if (
      !response.content ||
      Object.keys(response.content).some(
        (key) => !['title', 'body', 'retrievedAt', 'sourceUrl'].includes(key),
      )
    ) {
      throw new PublicApplicationError({ code: 'OPENCLI_FORBIDDEN' });
    }
    const title = response.content.title;
    const body = response.content.body;
    const sourceUrl = response.content.sourceUrl;
    if (
      (title !== undefined && typeof title !== 'string') ||
      (body !== undefined && typeof body !== 'string') ||
      sourceUrl !== normalizedUrl.normalized
    ) {
      throw new PublicApplicationError({ code: 'OPENCLI_FORBIDDEN' });
    }
    return toSafeOpenCliResponse({
      title,
      body,
      sourceUrl: normalizedUrl.normalized,
      retrievedAt: response.content.retrievedAt,
    }) as SafeGatewayContent;
  };
}

export {
  assertGatewayElapsedTime,
  assertGatewayRedirectCount,
  assertGatewayResponseSize,
  assertSafeGatewayUrl,
  assertSafeRedirect,
  isPrivateOrReservedIp,
} from './url-security';
