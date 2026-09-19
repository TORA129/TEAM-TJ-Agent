import 'server-only';

import {
  assertJobTransition,
  classifyJobFailure,
  emptyJobSourceSummary,
  phaseForJobStatus,
  type JobAcceptedDTO,
  type JobFailureInput,
  type JobStatusDTO,
} from '@/domain/jobs';
import type {
  Job,
  JobFallback,
  JobKind,
  JobSourceSummary,
  SourceRecordType,
  UUID,
} from '@/domain/persistence/models';
import type { JobRepository, VersionConflict } from '@/domain/persistence/repositories';
import {
  getPublicErrorPolicy,
  isPublicErrorCode,
  PublicApplicationError,
  redactPublicText,
  type PublicErrorCode,
} from '@/server/public-errors';

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_POLL_AFTER_MS = 2_000;

export interface JobSourceSummaryInput {
  readonly sourceRecordId?: UUID;
  readonly sourceType?: SourceRecordType;
  readonly version?: number;
  readonly capturedAt?: Date;
  readonly accessLimitations?: readonly string[];
}

export interface CreateJobInput {
  readonly operatorId: UUID;
  readonly kind: JobKind;
  readonly entityId: UUID;
  readonly inputVersion: number;
  readonly idempotencyKey: string;
  readonly sourceSummary?: JobSourceSummaryInput;
  readonly maxAttempts?: number;
}

export interface CreateJobResult {
  readonly job: Job;
  readonly created: boolean;
}

export interface JobServiceOptions {
  readonly maxAttempts?: number;
  readonly maxRetries?: number;
  readonly pollAfterMs?: number;
  readonly now?: () => Date;
}

export class JobService {
  private readonly maxAttempts: number;
  private readonly pollAfterMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly repository: JobRepository,
    options: JobServiceOptions = {},
  ) {
    this.maxAttempts = assertPositiveInteger(
      options.maxAttempts ??
        (options.maxRetries !== undefined
          ? assertNonNegativeInteger(options.maxRetries, 'maxRetries') + 1
          : DEFAULT_MAX_ATTEMPTS),
      'maxAttempts',
    );
    this.pollAfterMs = assertPositiveInteger(
      options.pollAfterMs ?? DEFAULT_POLL_AFTER_MS,
      'pollAfterMs',
    );
    this.now = options.now ?? (() => new Date());
  }

  async create(input: CreateJobInput): Promise<CreateJobResult> {
    assertSafeId(input.operatorId, 'operatorId');
    assertSafeId(input.entityId, 'entityId');
    assertSafeText(input.idempotencyKey, 'idempotencyKey');
    assertPositiveInteger(input.inputVersion, 'inputVersion');

    const existing = await this.repository.getByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      if (
        existing.operatorId !== input.operatorId ||
        existing.kind !== input.kind ||
        existing.entityId !== input.entityId ||
        existing.inputVersion !== input.inputVersion
      ) {
        throw new PublicApplicationError({
          code: 'REQUEST_INVALID',
          fieldErrors: {
            idempotencyKey: ['This key is already associated with different job inputs.'],
          },
        });
      }
      return { job: existing, created: false };
    }

    const maxAttempts = assertPositiveInteger(
      input.maxAttempts ?? this.maxAttempts,
      'maxAttempts',
    );
    let created: Job;
    try {
      created = await this.repository.create({
        operatorId: input.operatorId,
        kind: input.kind,
        status: 'QUEUED',
        phase: 'QUEUED',
        entityId: input.entityId,
        inputVersion: input.inputVersion,
        idempotencyKey: input.idempotencyKey,
        version: 1,
        attemptCount: 0,
        maxAttempts,
        sourceSummary: normalizeSourceSummary(input.sourceSummary),
        fallback: noFallback(),
      });
    } catch (error) {
      // A concurrent request may win the unique idempotency-key insert.
      // Resolve that race as the same accepted job instead of duplicating work.
      const raced = await this.repository.getByIdempotencyKey(input.idempotencyKey);
      if (!raced) throw error;
      if (
        raced.operatorId !== input.operatorId ||
        raced.kind !== input.kind ||
        raced.entityId !== input.entityId ||
        raced.inputVersion !== input.inputVersion
      ) {
        throw new PublicApplicationError({ code: 'REQUEST_INVALID' });
      }
      return { job: raced, created: false };
    }
    return { job: created, created: true };
  }

  async getStatus(input: { readonly jobId: UUID; readonly operatorId: UUID }): Promise<JobStatusDTO> {
    const job = await this.getOwned(input.jobId, input.operatorId);
    return toPublicJobStatusDTO(job, this.pollAfterMs);
  }

  async start(jobId: UUID): Promise<Job> {
    const job = await this.get(jobId);
    if (job.status !== 'QUEUED') {
      throw invalidTransition(job.status, 'RUNNING');
    }
    assertJobTransition(job.status, 'RUNNING');
    return this.update(job, {
      status: 'RUNNING',
      phase: 'RUNNING',
      attemptCount: job.attemptCount + 1,
      startedAt: this.now(),
      finishedAt: undefined,
      fallback: noFallback(),
    });
  }

  async succeed(input: { readonly jobId: UUID; readonly sourceRecordId?: UUID }): Promise<Job> {
    const job = await this.get(input.jobId);
    if (job.status !== 'RUNNING') {
      throw invalidTransition(job.status, 'SUCCEEDED');
    }
    assertJobTransition(job.status, 'SUCCEEDED');
    return this.update(job, {
      status: 'SUCCEEDED',
      phase: 'SUCCEEDED',
      sourceRecordId: safeOptionalId(input.sourceRecordId),
      finishedAt: this.now(),
      fallback: noFallback(),
    });
  }

  async fail(input: {
    readonly jobId: UUID;
    readonly failure: JobFailureInput;
    readonly sourceRecordId?: UUID;
  }): Promise<Job> {
    const job = await this.get(input.jobId);
    const classification = classifyJobFailure(input.failure);
    const sourceRecordId = safeOptionalId(input.sourceRecordId);
    const originalCode = publicFailureCode(input.failure, classification.category);

    if (classification.retryable && job.attemptCount < job.maxAttempts) {
      assertJobTransition(job.status, 'RETRYABLE_FAILURE');
      const retryableFailure = await this.update(job, {
        status: 'RETRYABLE_FAILURE',
        phase: 'RETRYING',
        errorCode: originalCode,
        sourceRecordId,
        fallback: { required: false, action: 'WAIT_AND_RETRY', errorCode: originalCode },
      });
      assertJobTransition(retryableFailure.status, 'QUEUED');
      return this.update(retryableFailure, {
        status: 'QUEUED',
        phase: 'RETRYING',
        fallback: { required: false, action: 'WAIT_AND_RETRY', errorCode: originalCode },
      });
    }

    const exhausted = classification.retryable && job.attemptCount >= job.maxAttempts;
    const terminalCode = exhausted ? 'RETRY_EXHAUSTED' : originalCode;
    if (job.status !== 'QUEUED' && job.status !== 'RUNNING') {
      throw invalidTransition(job.status, 'TERMINAL_FAILURE');
    }
    assertJobTransition(job.status, 'TERMINAL_FAILURE');
    return this.update(job, {
      status: 'TERMINAL_FAILURE',
      phase: 'MANUAL_FALLBACK',
      errorCode: terminalCode,
      sourceRecordId,
      finishedAt: this.now(),
      fallback: {
        required: true,
        action: fallbackAction(terminalCode),
        errorCode: terminalCode,
      },
    });
  }

  private async get(jobId: UUID): Promise<Job> {
    assertSafeId(jobId, 'jobId');
    const job = await this.repository.getById(jobId);
    if (!job) throw jobNotFound();
    return job;
  }

  private async getOwned(jobId: UUID, operatorId: UUID): Promise<Job> {
    const job = await this.get(jobId);
    assertSafeId(operatorId, 'operatorId');
    // Deliberately return the same not-found error for another Operator so the
    // endpoint cannot be used to enumerate jobs owned by someone else.
    if (job.operatorId !== operatorId) throw jobNotFound();
    return job;
  }

  private async update(
    job: Job,
    input: Partial<
      Pick<
        Job,
        | 'status'
        | 'phase'
        | 'attemptCount'
        | 'errorCode'
        | 'sourceRecordId'
        | 'sourceSummary'
        | 'fallback'
        | 'startedAt'
        | 'finishedAt'
      >
    >,
  ): Promise<Job> {
    const updated = await this.repository.update(job.id, {
      expectedVersion: job.version,
      ...input,
    });
    if (isVersionConflict(updated)) {
      throw new PublicApplicationError({
        code: 'VERSION_CONFLICT',
        currentVersion: updated.actualVersion,
      });
    }
    return updated;
  }
}

export function toPublicJobStatusDTO(job: Job, pollAfterMs = DEFAULT_POLL_AFTER_MS): JobStatusDTO {
  const phase = job.phase ?? phaseForJobStatus(job.status);
  const errorCode = safeErrorCode(job.errorCode);
  const policy = errorCode ? getPublicErrorPolicy(errorCode) : undefined;
  const retrying = phase === 'RETRYING';
  const fallback = job.fallback ?? noFallback();

  return {
    jobId: job.id,
    kind: job.kind,
    status: job.status,
    phase,
    inputVersion: job.inputVersion,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    pollAfterMs: assertPositiveInteger(pollAfterMs, 'pollAfterMs'),
    sourceSummary: publicSourceSummary(job.sourceSummary ?? emptyJobSourceSummary()),
    fallback: {
      required: fallback.required,
      action: fallback.action,
      ...(fallback.errorCode ? { errorCode: safeErrorCode(fallback.errorCode) } : {}),
    },
    ...(errorCode && policy
      ? {
          error: {
            code: errorCode,
            message: policy.message,
            action: retrying ? 'WAIT_AND_RETRY_OR_MANUAL' : policy.action,
            retryable: retrying,
          },
        }
      : {}),
  };
}

export function acceptedJobResponse(result: CreateJobResult, basePath = '/api/jobs'): Response {
  const dto: JobAcceptedDTO = {
    accepted: true,
    jobId: result.job.id,
    status: 'QUEUED',
    phase: 'QUEUED',
    inputVersion: result.job.inputVersion,
    pollUrl: `${basePath}/${encodeURIComponent(result.job.id)}`,
  };
  const headers = new Headers({
    'content-type': 'application/json',
    location: dto.pollUrl,
  });
  return new Response(JSON.stringify(dto), { status: 202, headers });
}

function normalizeSourceSummary(input?: JobSourceSummaryInput): JobSourceSummary {
  const sourceRecordId = safeOptionalId(input?.sourceRecordId);
  const version = input?.version;
  const capturedAt = input?.capturedAt;
  return {
    ...(sourceRecordId ? { sourceRecordId } : {}),
    ...(input?.sourceType ? { sourceType: input.sourceType } : {}),
    ...(version !== undefined && Number.isSafeInteger(version) && version >= 0 ? { version } : {}),
    ...(capturedAt instanceof Date && !Number.isNaN(capturedAt.getTime())
      ? { capturedAt: new Date(capturedAt.getTime()) }
      : {}),
    accessLimitations: (input?.accessLimitations ?? [])
      .slice(0, 8)
      .map((value) => redactPublicText(String(value)))
      .filter(Boolean),
    redacted: true,
  };
}

function publicSourceSummary(summary: JobSourceSummary): JobStatusDTO['sourceSummary'] {
  return {
    ...(summary.sourceRecordId && SAFE_ID_PATTERN.test(summary.sourceRecordId)
      ? { sourceRecordId: summary.sourceRecordId }
      : {}),
    ...(summary.sourceType ? { sourceType: summary.sourceType } : {}),
    ...(summary.version !== undefined ? { version: summary.version } : {}),
    ...(summary.capturedAt ? { capturedAt: summary.capturedAt.toISOString() } : {}),
    accessLimitations: summary.accessLimitations.slice(0, 8).map((value) => redactPublicText(value)),
    redacted: true,
  };
}

function noFallback(): JobFallback {
  return { required: false, action: 'NONE' };
}

function fallbackAction(code: string): string {
  if (isPublicErrorCode(code)) return getPublicErrorPolicy(code).action;
  return 'RETRY_OR_USE_MANUAL_FALLBACK';
}

function publicFailureCode(
  failure: JobFailureInput,
  category: ReturnType<typeof classifyJobFailure>['category'],
): string {
  if (failure.code && isPublicErrorCode(failure.code)) return failure.code;
  if (category === 'RATE_LIMIT') return 'RATE_LIMITED';
  if (category === 'TIMEOUT') return 'JOB_RETRYABLE_FAILURE';
  if (category === 'TRANSIENT_5XX' || category === 'STORAGE_TRANSIENT') {
    return 'JOB_RETRYABLE_FAILURE';
  }
  return 'INTERNAL_ERROR';
}

function safeErrorCode(code: string | undefined): PublicErrorCode | undefined {
  return code && isPublicErrorCode(code) ? code : undefined;
}

function invalidTransition(from: Job['status'], to: Job['status']): PublicApplicationError {
  return new PublicApplicationError({
    code: 'REQUEST_INVALID',
    fieldErrors: { status: [`Job cannot transition from ${from} to ${to}.`] },
  });
}

function jobNotFound(): PublicApplicationError {
  return new PublicApplicationError({ code: 'JOB_NOT_FOUND' });
}

function assertSafeId(value: string, name: string): void {
  if (!SAFE_ID_PATTERN.test(value)) {
    throw new PublicApplicationError({
      code: 'VALIDATION_FAILED',
      fieldErrors: { [name]: ['Use a safe identifier.'] },
    });
  }
}

function safeOptionalId(value: string | undefined): UUID | undefined {
  if (value === undefined) return undefined;
  assertSafeId(value, 'sourceRecordId');
  return value;
}

function assertSafeText(value: string, name: string): void {
  if (!value.trim() || value.length > 200) {
    throw new PublicApplicationError({
      code: 'VALIDATION_FAILED',
      fieldErrors: { [name]: ['Use a non-empty value within the allowed length.'] },
    });
  }
}

function assertPositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new PublicApplicationError({
      code: 'VALIDATION_FAILED',
      fieldErrors: { [name]: ['Use a positive safe integer.'] },
    });
  }
  return value;
}

function isVersionConflict(value: Job | VersionConflict): value is VersionConflict {
  return (
    'expectedVersion' in value && 'actualVersion' in value && 'entityId' in value
  );
}

function assertNonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PublicApplicationError({
      code: 'VALIDATION_FAILED',
      fieldErrors: { [name]: ['Use a non-negative safe integer.'] },
    });
  }
  return value;
}
