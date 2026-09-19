import 'server-only';

import type {
  AuditEvent,
  SourceRecord,
  UUID,
} from '../../domain/persistence/models';
import {
  redactPublicText,
  redactSensitiveValue,
  redactText,
  safeIdentifier,
  safeJsonStringify,
} from '../../domain/security/redaction';

export type SafeSourceRecordSummary = Readonly<{
  readonly id: UUID;
  readonly sourceType: SourceRecord['sourceType'];
  readonly sourceRef: string;
  readonly version: number;
  readonly capturedAt: string;
  readonly parentSourceRecordIds: readonly UUID[];
  readonly accessLimitations: readonly string[];
  readonly redactionStatus: SourceRecord['redactionStatus'];
}>;

export function toSafeSourceRecordSummary(record: SourceRecord): SafeSourceRecordSummary {
  return {
    id: safeIdentifier(record.id) ?? 'unknown-source',
    sourceType: record.sourceType,
    sourceRef: redactPublicText(record.sourceRef),
    version: Number.isSafeInteger(record.version) && record.version >= 0 ? record.version : 0,
    capturedAt: record.capturedAt.toISOString(),
    parentSourceRecordIds: record.parentSourceRecordIds.filter(
      (id): id is UUID => safeIdentifier(id) !== undefined,
    ),
    accessLimitations: record.accessLimitations.map((value) => redactPublicText(value)),
    redactionStatus: record.redactionStatus,
  };
}

export type SafeAuditEventDTO = Readonly<{
  readonly actorType: AuditEvent['actorType'];
  readonly action: string;
  readonly entityType: string;
  readonly entityId: UUID;
  readonly resultStatus: string;
  readonly sourceRecordId?: UUID;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly toolId?: string;
  readonly traceId: string;
}>;

/** Audit DTO intentionally omits reason, actor identity and hashes. */
export function toSafeAuditEventDTO(event: AuditEvent): SafeAuditEventDTO {
  return {
    actorType: event.actorType,
    action: redactPublicText(event.action),
    entityType: redactPublicText(event.entityType),
    entityId: safeIdentifier(event.entityId) ?? 'unknown-entity',
    resultStatus: redactPublicText(event.resultStatus),
    ...(safeIdentifier(event.sourceRecordId)
      ? { sourceRecordId: safeIdentifier(event.sourceRecordId) }
      : {}),
    ...(safeIdentifier(event.providerId) ? { providerId: safeIdentifier(event.providerId) } : {}),
    ...(safeIdentifier(event.modelId) ? { modelId: safeIdentifier(event.modelId) } : {}),
    ...(safeIdentifier(event.toolId) ? { toolId: safeIdentifier(event.toolId) } : {}),
    traceId: safeIdentifier(event.traceId) ?? 'unknown-trace',
  };
}

/** General-purpose API boundary helper; unknown keys are retained only after recursive redaction. */
export function toSafeApiDTO<T>(value: T): T {
  return redactSensitiveValue(value) as T;
}

export function safeJsonResponse<T>(value: T, init?: ResponseInit): Response {
  return Response.json(toSafeApiDTO(value), init);
}

export function toSafeOpenCliResponse<T>(value: T): T {
  return toSafeApiDTO(value);
}

export function toSafeStorageOrDatabaseError(error: unknown, fallbackCode: string): {
  readonly code: string;
} {
  const candidate = error && typeof error === 'object' ? (error as { readonly code?: unknown }) : {};
  const code = typeof candidate.code === 'string' && /^[A-Z][A-Z0-9_.:-]{0,63}$/.test(candidate.code)
    ? candidate.code
    : /^[A-Z][A-Z0-9_.:-]{0,63}$/.test(fallbackCode)
      ? fallbackCode
      : 'INFRASTRUCTURE_ERROR';
  return { code };
}

/**
 * Markdown export helper. It accepts already-rendered business Markdown but
 * strips secrets, internal paths, credentials and exception traces before the
 * string can leave the server.
 */
export function toSafeMarkdownExport(markdown: string): string {
  return redactText(markdown)
    .replace(/(^|\n)\s*(?:stack|traceback|cause)\s*:[^\n]*/gi, '$1')
    .replace(/(^|\n)\s*```(?:stack|trace|error)[\s\S]*?```/gi, '$1')
    .slice(0, 200_000);
}

export function safeSerializeForExport(value: unknown): string {
  return toSafeMarkdownExport(safeJsonStringify(value));
}
