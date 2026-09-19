import type { Job, JobKind, JobPhase, JobStatus, JobSourceSummary, UUID } from './persistence/models';

export type JobFailureCategory =
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'TRANSIENT_5XX'
  | 'STORAGE_TRANSIENT'
  | 'NON_RETRYABLE';

export interface JobFailureInput {
  readonly code?: string;
  readonly status?: number;
  readonly category?: string;
}

export interface JobFailureClassification {
  readonly category: JobFailureCategory;
  readonly retryable: boolean;
}

export interface JobStatusErrorDTO {
  readonly code: string;
  readonly message: string;
  readonly action: string;
  readonly retryable: boolean;
}

export interface JobStatusDTO {
  readonly jobId: UUID;
  readonly kind: JobKind;
  readonly status: JobStatus;
  readonly phase: JobPhase;
  readonly inputVersion: number;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly pollAfterMs: number;
  readonly sourceSummary: {
    readonly sourceRecordId?: UUID;
    readonly sourceType?: string;
    readonly version?: number;
    readonly capturedAt?: string;
    readonly accessLimitations: readonly string[];
    readonly redacted: true;
  };
  readonly fallback: {
    readonly required: boolean;
    readonly action: string;
    readonly errorCode?: string;
  };
  readonly error?: JobStatusErrorDTO;
}

export interface JobAcceptedDTO {
  readonly accepted: true;
  readonly jobId: UUID;
  readonly status: 'QUEUED';
  readonly phase: 'QUEUED';
  readonly inputVersion: number;
  readonly pollUrl: string;
}

export class JobTransitionError extends Error {
  readonly code = 'INVALID_JOB_TRANSITION' as const;

  constructor(
    readonly from: JobStatus,
    readonly to: JobStatus,
  ) {
    super(`Invalid job transition: ${from} -> ${to}`);
    this.name = 'JobTransitionError';
  }
}

/**
 * Only categories explicitly allowed by the workflow may be retried. A
 * generic retryable flag is intentionally ignored so provider-specific
 * adapters cannot widen the retry policy accidentally.
 */
export function classifyJobFailure(input: JobFailureInput): JobFailureClassification {
  const code = input.code?.toUpperCase();
  const category = input.category?.toUpperCase();

  if (
    category === 'RATE_LIMIT' ||
    code === 'RATE_LIMITED' ||
    code === 'MODEL_RATE_LIMITED' ||
    input.status === 429
  ) {
    return { category: 'RATE_LIMIT', retryable: true };
  }

  if (
    category === 'TIMEOUT' ||
    code === 'OPENCLI_TIMEOUT' ||
    code === 'TIMEOUT' ||
    code === 'ETIMEDOUT' ||
    input.status === 408
  ) {
    return { category: 'TIMEOUT', retryable: true };
  }

  if (category === 'STORAGE_TRANSIENT' || isStorageTransientCode(code)) {
    return { category: 'STORAGE_TRANSIENT', retryable: true };
  }

  if (category === 'TRANSIENT_5XX' || isTransientServerError(input.status)) {
    return { category: 'TRANSIENT_5XX', retryable: true };
  }

  return { category: 'NON_RETRYABLE', retryable: false };
}

export function assertJobTransition(from: JobStatus, to: JobStatus): void {
  const valid =
    (from === 'QUEUED' &&
      (to === 'RUNNING' || to === 'RETRYABLE_FAILURE' || to === 'TERMINAL_FAILURE')) ||
    (from === 'RUNNING' &&
      (to === 'SUCCEEDED' || to === 'RETRYABLE_FAILURE' || to === 'TERMINAL_FAILURE')) ||
    (from === 'RETRYABLE_FAILURE' && to === 'QUEUED');

  if (!valid) throw new JobTransitionError(from, to);
}

export function phaseForJobStatus(status: JobStatus, retrying = false): JobPhase {
  if (status === 'QUEUED') return retrying ? 'RETRYING' : 'QUEUED';
  if (status === 'RUNNING') return 'RUNNING';
  if (status === 'SUCCEEDED') return 'SUCCEEDED';
  if (status === 'RETRYABLE_FAILURE') return 'RETRYING';
  return 'MANUAL_FALLBACK';
}

export function isTerminalJobStatus(status: JobStatus): boolean {
  return status === 'SUCCEEDED' || status === 'TERMINAL_FAILURE';
}

export function isStorageTransientCode(code: string | undefined): boolean {
  return (
    code === 'STORAGE_TRANSIENT' ||
    code === 'STORAGE_UNAVAILABLE' ||
    code === 'OBJECT_STORAGE_TRANSIENT' ||
    code === 'OBJECT_STORAGE_UNAVAILABLE' ||
    code === 'STORAGE_TIMEOUT'
  );
}

export function isTransientServerError(status: number | undefined): boolean {
  return status !== undefined && Number.isInteger(status) && status >= 500 && status <= 599;
}

export function emptyJobSourceSummary(): JobSourceSummary {
  return { accessLimitations: [], redacted: true };
}

export function isJobKind(value: unknown): value is JobKind {
  return (
    value === 'COPY_GENERATION' ||
    value === 'FILE_PARSE' ||
    value === 'COVER_GENERATION' ||
    value === 'OPENCLI_FETCH' ||
    value === 'REVIEW_EVALUATION'
  );
}

export function isJob(value: unknown): value is Job {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'id' in value &&
      'kind' in value &&
      isJobKind((value as { kind?: unknown }).kind),
  );
}
