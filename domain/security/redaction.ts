import type { AuditEvent, SourceRecord } from '../persistence/models';

export const REDACTED_VALUE = '[redacted]';
export const REDACTED_PATH = '[internal path]';
export const REDACTED_CONNECTION = '[redacted connection string]';
export const REDACTED_STACK = '[internal stack omitted]';
export const OMITTED_BINARY = '[binary omitted]';

const SENSITIVE_KEY_PATTERN =
  /(?:api[_-]?key|access[_-]?key|secret|password|passwd|credential|authorization|cookie|set-cookie|token|private[_-]?key|client[_-]?secret|connection[_-]?string|database[_-]?url|dsn)/i;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_.:-]{0,63}$/;
const CONNECTION_SCHEME_PATTERN =
  /\b(?:postgres(?:ql)?|mysql(?:2)?|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?|jdbc|file):\/\/[^\s"'`<>]+/gi;
const URL_USERINFO_PATTERN = /https?:\/\/[^\s/@]+:[^\s/@]+@[^\s]+/gi;
const AUTHORIZATION_PATTERN = /\b(?:bearer|basic)\s+[^\s,;]+/gi;
const HEADER_VALUE_PATTERN =
  /\b(?:authorization|cookie|set-cookie|x-api-key|api-key|token|password|secret|credential|api[_-]?key)\s*[:=]\s*(?:(?:bearer|basic)\s+)?[^\s,;]+/gi;
const ENV_VALUE_PATTERN =
  /\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)\b\s*=\s*[^\s,;]+/g;
const PEM_PATTERN = /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g;
const SECRET_LIKE_VALUE_PATTERN = /\b(?:secret|credential|password|token|api[_-]?key)(?:[-_][A-Za-z0-9]+)+\b/gi;
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'`,)]+/g;
const UNIX_PATH_PATTERN = /(?:^|[\s("'`])\/(?:Users|home|root|workspace|app|var|etc|tmp|opt|srv|private|mnt)\/[^\s"'`,)]*/gi;
const STACK_LINE_PATTERN = /(^|\n)\s*at\s+[^\n]+/g;

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === 'string' && SAFE_IDENTIFIER_PATTERN.test(value);
}

function redactStandaloneSecret(value: string): string {
  return value
    .replace(PEM_PATTERN, REDACTED_VALUE)
    .replace(CONNECTION_SCHEME_PATTERN, REDACTED_CONNECTION)
    .replace(URL_USERINFO_PATTERN, REDACTED_CONNECTION)
    .replace(HEADER_VALUE_PATTERN, REDACTED_VALUE)
    .replace(AUTHORIZATION_PATTERN, '[redacted authorization]')
    .replace(SECRET_LIKE_VALUE_PATTERN, REDACTED_VALUE)
    .replace(ENV_VALUE_PATTERN, '[redacted environment value]')
    .replace(STACK_LINE_PATTERN, `$1${REDACTED_STACK}`)
    .replace(WINDOWS_PATH_PATTERN, REDACTED_PATH)
    .replace(UNIX_PATH_PATTERN, `$1${REDACTED_PATH}`);
}

export function redactText(value: string): string {
  return redactStandaloneSecret(value);
}

/**
 * Redacts text that can be shown as a bounded public diagnostic.
 */
export function redactPublicText(value: string): string {
  return redactText(value).slice(0, 240);
}

function redactError(value: Error): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const candidate = value as Error & { readonly code?: unknown; readonly status?: unknown };
  if (typeof candidate.code === 'string' && SAFE_ERROR_CODE_PATTERN.test(candidate.code)) {
    result.code = candidate.code;
  }
  if (typeof candidate.status === 'number' && Number.isInteger(candidate.status)) {
    result.status = candidate.status;
  }
  return result;
}

/**
 * Recursively copies an unknown value while removing credential-like keys,
 * sanitizing secret-like strings, omitting stacks and preserving no object
 * references. Circular structures are represented by a fixed marker.
 */
export function redactSensitiveValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value === undefined) return undefined;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof Error) return redactError(value);
  if (value instanceof Uint8Array) return OMITTED_BINARY;
  if (typeof value !== 'object') return undefined;
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValue(item, seen));
  }

  const result: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (key === 'stack') {
      result[key] = REDACTED_STACK;
    } else if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = REDACTED_VALUE;
    } else {
      result[key] = redactSensitiveValue(nestedValue, seen);
    }
  }
  return result;
}

/** Converts arbitrary data to JSON only after recursive redaction. */
export function safeJsonStringify(value: unknown): string {
  const redacted = redactSensitiveValue(value);
  try {
    return JSON.stringify(redacted) ?? 'null';
  } catch {
    return JSON.stringify({ error: 'SERIALIZATION_FAILED' });
  }
}

export interface ModelMessageLike {
  readonly role: string;
  readonly content: string;
  readonly [key: string]: unknown;
}

export function redactModelMessages<T extends ModelMessageLike>(messages: readonly T[]): T[] {
  return messages.map((message) => {
    const safe = redactSensitiveValue(message) as Record<string, unknown>;
    return {
      ...safe,
      role: typeof safe.role === 'string' ? safe.role : 'user',
      content: typeof safe.content === 'string' ? safe.content : '',
    } as T;
  });
}

export function safeIdentifier(value: unknown): string | undefined {
  return isSafeIdentifier(value) ? value : undefined;
}

export function safeErrorCode(error: unknown, fallback = 'INTERNAL_ERROR'): string {
  if (typeof error === 'string' && SAFE_ERROR_CODE_PATTERN.test(error)) return error;
  if (error && typeof error === 'object') {
    const candidate = error as { readonly code?: unknown; readonly status?: unknown };
    if (typeof candidate.code === 'string' && SAFE_ERROR_CODE_PATTERN.test(candidate.code)) {
      return candidate.code;
    }
    if (typeof candidate.status === 'number' && Number.isInteger(candidate.status)) {
      return `HTTP_${candidate.status}`;
    }
  }
  return SAFE_ERROR_CODE_PATTERN.test(fallback) ? fallback : 'INTERNAL_ERROR';
}

export function toSafeInfrastructureError(error: unknown, fallbackMessage: string): Error {
  const rawMessage = error instanceof Error ? error.message : '';
  const potentiallySensitive =
    /(?:secret|password|credential|authorization|cookie|token|api[_-]?key|connection|postgres|mysql|redis|mongodb|https?:\/\/|[A-Za-z]:[\\/]|(^|\n)\s*at\s+)/i.test(
      rawMessage,
    );
  const message =
    rawMessage && !potentiallySensitive ? redactPublicText(rawMessage) : fallbackMessage;
  const safeError = new Error(message || fallbackMessage);
  Object.defineProperty(safeError, 'code', {
    value: safeErrorCode(error, 'INFRASTRUCTURE_ERROR'),
    enumerable: true,
  });
  return safeError;
}

export type SafeSourceRecordWrite = Omit<SourceRecord, 'id' | 'createdAt' | 'createdBy'>;

export function sanitizeSourceRecordWrite(input: SafeSourceRecordWrite): SafeSourceRecordWrite {
  return {
    ...input,
    sourceRef: redactPublicText(input.sourceRef),
    parentSourceRecordIds: input.parentSourceRecordIds.filter(isSafeIdentifier),
    accessLimitations: input.accessLimitations.map((value) => redactPublicText(value)),
    operatorId: safeIdentifier(input.operatorId),
  };
}

export type SafeAuditEventWrite = Omit<AuditEvent, 'id' | 'createdAt' | 'createdBy'>;

export function sanitizeAuditEventWrite(input: SafeAuditEventWrite): SafeAuditEventWrite {
  return {
    ...input,
    actorId: safeIdentifier(input.actorId),
    entityId: safeIdentifier(input.entityId) ?? 'unknown-entity',
    sourceRecordId: safeIdentifier(input.sourceRecordId),
    providerId: safeIdentifier(input.providerId),
    modelId: safeIdentifier(input.modelId),
    toolId: safeIdentifier(input.toolId),
    traceId: safeIdentifier(input.traceId) ?? 'unknown-trace',
    reason: input.reason === undefined ? undefined : redactPublicText(input.reason),
  };
}
