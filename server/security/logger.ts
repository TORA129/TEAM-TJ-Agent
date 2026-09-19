import 'server-only';

import {
  redactPublicText,
  safeErrorCode,
  safeIdentifier,
  safeJsonStringify,
} from '../../domain/security/redaction';

export type StructuredLogInput = {
  readonly status?: unknown;
  readonly provider?: unknown;
  readonly providerId?: unknown;
  readonly model?: unknown;
  readonly modelId?: unknown;
  readonly tool?: unknown;
  readonly toolId?: unknown;
  readonly job?: unknown;
  readonly jobId?: unknown;
  readonly trace?: unknown;
  readonly traceId?: unknown;
  readonly error?: unknown;
  readonly errorCode?: unknown;
  readonly source?: unknown;
  readonly sourceId?: unknown;
  readonly sourceRecordId?: unknown;
  readonly [key: string]: unknown;
};

export type SafeStructuredLogFields = Readonly<{
  readonly status?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly tool?: string;
  readonly job?: string;
  readonly trace?: string;
  readonly error?: string;
  readonly source?: string;
}>;

export type LogLevel = 'info' | 'warn' | 'error';
export type StructuredLogSink = (level: LogLevel, line: string) => void;

function safeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const redacted = redactPublicText(value);
  return redacted.length > 0 ? redacted : undefined;
}

function pickIdentifier(...values: unknown[]): string | undefined {
  for (const value of values) {
    const identifier = safeIdentifier(value);
    if (identifier) return identifier;
  }
  return undefined;
}

function pickModelIdentifier(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)) {
      return value;
    }
  }
  return undefined;
}

/** Keeps only the eight operational log fields allowed by the security contract. */
export function toAllowlistedLogFields(input: StructuredLogInput): SafeStructuredLogFields {
  const result: Record<string, string> = {};
  const status = safeText(input.status);
  const provider = pickIdentifier(input.provider, input.providerId);
  const model = pickModelIdentifier(input.model, input.modelId);
  const tool = pickIdentifier(input.tool, input.toolId);
  const job = pickIdentifier(input.job, input.jobId);
  const trace = pickIdentifier(input.trace, input.traceId);
  const source = pickIdentifier(input.source, input.sourceId, input.sourceRecordId);
  const errorCandidate = input.errorCode ?? input.error;

  if (status) result.status = status;
  if (provider) result.provider = provider;
  if (model) result.model = model;
  if (tool) result.tool = tool;
  if (job) result.job = job;
  if (trace) result.trace = trace;
  if (errorCandidate !== undefined) result.error = safeErrorCode(errorCandidate);
  if (source) result.source = source;

  return result;
}

const defaultSink: StructuredLogSink = (level, line) => {
  const output = `${line}\n`;
  if (level === 'error') process.stderr.write(output);
  else process.stdout.write(output);
};

export interface StructuredLogger {
  readonly info: (fields: StructuredLogInput) => void;
  readonly warn: (fields: StructuredLogInput) => void;
  readonly error: (fields: StructuredLogInput) => void;
}

/**
 * Creates a structured logger that never serializes an arbitrary Error. The
 * sink receives JSON containing only the allowlisted operational fields.
 */
export function createStructuredLogger(sink: StructuredLogSink = defaultSink): StructuredLogger {
  const write = (level: LogLevel, fields: StructuredLogInput): void => {
    const safeFields = toAllowlistedLogFields(fields);
    sink(level, safeJsonStringify(safeFields));
  };

  return {
    info: (fields) => write('info', fields),
    warn: (fields) => write('warn', fields),
    error: (fields) => write('error', fields),
  };
}

export const logger = createStructuredLogger();
