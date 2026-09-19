import { describe, expect, it } from 'vitest';

import { acceptedJobResponse, JobService } from '../../server/jobs/service';
import { createJobGetHandler } from '../../server/jobs/http';
import type { Job, UUID } from '../../domain/persistence/models';
import type { JobRepository, VersionConflict } from '../../domain/persistence/repositories';
import type { TrustedOperatorSession } from '../../server/auth/session';
import { createTrustedSessionResolver } from '../../server/auth/session';

class InMemoryJobRepository implements JobRepository {
  readonly records = new Map<UUID, Job>();
  readonly updates: Job[] = [];

  async create(input: Omit<Job, 'id' | 'createdAt' | 'createdBy' | 'updatedAt'>): Promise<Job> {
    const id = `job-${this.records.size + 1}`;
    if ([...this.records.values()].some((job) => job.idempotencyKey === input.idempotencyKey)) {
      throw new Error('unique idempotency constraint');
    }
    const now = new Date();
    const job: Job = { ...input, id, createdAt: now, createdBy: 'SYSTEM', updatedAt: now };
    this.records.set(id, job);
    return job;
  }

  async getById(id: UUID): Promise<Job | null> {
    return this.records.get(id) ?? null;
  }

  async getByIdempotencyKey(idempotencyKey: string): Promise<Job | null> {
    return [...this.records.values()].find((job) => job.idempotencyKey === idempotencyKey) ?? null;
  }

  async update(
    id: UUID,
    input: Parameters<JobRepository['update']>[1],
  ): Promise<Job | VersionConflict> {
    const current = this.records.get(id);
    if (!current) throw new Error('job not found');
    if (current.version !== input.expectedVersion) {
      return { entityId: id, expectedVersion: input.expectedVersion, actualVersion: current.version };
    }
    const next: Job = {
      ...current,
      ...input,
      version: current.version + 1,
      updatedAt: new Date(),
    };
    delete (next as { expectedVersion?: number }).expectedVersion;
    this.records.set(id, next);
    this.updates.push(next);
    return next;
  }
}

const session: TrustedOperatorSession = {
  sessionId: 'session-1',
  operatorId: 'operator-1',
  roles: ['OPERATOR'],
  csrfToken: 'csrf-token',
};

function sessionResolver() {
  return createTrustedSessionResolver({
    async lookupByToken(token) {
      return token === 'opaque-token' ? session : null;
    },
  });
}

describe('provider-neutral long-running JobService', () => {
  it('persists input version/idempotency and returns 202 semantics without duplicating a job', async () => {
    const repository = new InMemoryJobRepository();
    const service = new JobService(repository, { maxAttempts: 3, pollAfterMs: 750 });
    const input = {
      operatorId: 'operator-1',
      kind: 'COPY_GENERATION' as const,
      entityId: 'session-1',
      inputVersion: 4,
      idempotencyKey: 'request-copy-v4',
    };

    const first = await service.create(input);
    const duplicate = await service.create(input);
    const response = acceptedJobResponse(first);

    expect(first.created).toBe(true);
    expect(duplicate).toEqual({ job: first.job, created: false });
    expect(first.job.inputVersion).toBe(4);
    expect(first.job.idempotencyKey).toBe('request-copy-v4');
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      accepted: true,
      jobId: first.job.id,
      pollUrl: `/api/jobs/${first.job.id}`,
    });
  });

  it('retries only transient failures, preserves the job across attempts, and can recover after refresh', async () => {
    const repository = new InMemoryJobRepository();
    const service = new JobService(repository, { maxAttempts: 2, pollAfterMs: 900 });
    const created = await service.create({
      operatorId: 'operator-1',
      kind: 'FILE_PARSE',
      entityId: 'file-1',
      inputVersion: 2,
      idempotencyKey: 'file-parse-2',
      sourceSummary: {
        sourceRecordId: 'source-1',
        sourceType: 'FILE',
        version: 2,
        accessLimitations: ['OPENROUTER_API_KEY=do-not-return'],
      },
    });

    await service.start(created.job.id);
    const queuedForRetry = await service.fail({
      jobId: created.job.id,
      failure: { status: 503, code: 'provider-temporary-failure' },
    });
    const refreshed = await service.getStatus({ jobId: created.job.id, operatorId: 'operator-1' });

    expect(queuedForRetry.status).toBe('QUEUED');
    expect(queuedForRetry.phase).toBe('RETRYING');
    expect(queuedForRetry.attemptCount).toBe(1);
    expect(refreshed).toMatchObject({
      jobId: created.job.id,
      inputVersion: 2,
      attemptCount: 1,
      maxAttempts: 2,
      phase: 'RETRYING',
      fallback: { required: false, action: 'WAIT_AND_RETRY' },
      sourceSummary: {
        sourceRecordId: 'source-1',
        sourceType: 'FILE',
        version: 2,
        redacted: true,
      },
    });
    expect(JSON.stringify(refreshed)).not.toContain('do-not-return');

    await service.start(created.job.id);
    const succeeded = await service.succeed({ jobId: created.job.id, sourceRecordId: 'source-2' });
    expect(succeeded.status).toBe('SUCCEEDED');
    expect((await service.getStatus({ jobId: created.job.id, operatorId: 'operator-1' })).phase).toBe(
      'SUCCEEDED',
    );
  });

  it('does not retry authorization/parameter failures and exposes terminal manual fallback', async () => {
    const repository = new InMemoryJobRepository();
    const service = new JobService(repository, { maxAttempts: 4 });
    const created = await service.create({
      operatorId: 'operator-1',
      kind: 'OPENCLI_FETCH',
      entityId: 'review-1',
      inputVersion: 1,
      idempotencyKey: 'review-fetch-1',
    });

    await service.start(created.job.id);
    const failed = await service.fail({
      jobId: created.job.id,
      failure: { code: 'OPENCLI_FORBIDDEN', status: 403 },
    });
    const status = await service.getStatus({ jobId: created.job.id, operatorId: 'operator-1' });

    expect(failed).toMatchObject({ status: 'TERMINAL_FAILURE', phase: 'MANUAL_FALLBACK' });
    expect(failed.attemptCount).toBe(1);
    expect(status.fallback).toMatchObject({ required: true, errorCode: 'OPENCLI_FORBIDDEN' });
    expect(status.error).toMatchObject({ code: 'OPENCLI_FORBIDDEN', retryable: false });
  });

  it('stops retrying at max attempts and rejects cross-operator status reads', async () => {
    const repository = new InMemoryJobRepository();
    const service = new JobService(repository, { maxAttempts: 1 });
    const created = await service.create({
      operatorId: 'operator-1',
      kind: 'COVER_GENERATION',
      entityId: 'cover-1',
      inputVersion: 1,
      idempotencyKey: 'cover-1',
    });

    await service.start(created.job.id);
    const exhausted = await service.fail({
      jobId: created.job.id,
      failure: { code: 'MODEL_RATE_LIMITED', status: 429 },
    });

    expect(exhausted).toMatchObject({
      status: 'TERMINAL_FAILURE',
      phase: 'MANUAL_FALLBACK',
      errorCode: 'RETRY_EXHAUSTED',
      attemptCount: 1,
      fallback: { required: true, action: 'RETRY_OR_USE_MANUAL_FALLBACK' },
    });
    await expect(
      service.getStatus({ jobId: created.job.id, operatorId: 'operator-2' }),
    ).rejects.toMatchObject({ code: 'JOB_NOT_FOUND' });
  });

  it('protects GET /api/jobs/:jobId with the existing trusted session boundary', async () => {
    const repository = new InMemoryJobRepository();
    const service = new JobService(repository);
    const created = await service.create({
      operatorId: 'operator-1',
      kind: 'REVIEW_EVALUATION',
      entityId: 'review-1',
      inputVersion: 3,
      idempotencyKey: 'review-evaluation-3',
    });
    const handler = createJobGetHandler(service, {
      resolveSession: sessionResolver(),
      allowedOrigins: ['https://team-tj.example.test'],
    });
    const response = await handler(
      new Request('https://team-tj.example.test/api/jobs/job-1', {
        headers: { cookie: 'team_tj_session=opaque-token' },
      }),
      { params: { jobId: created.job.id } },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ jobId: created.job.id, phase: 'QUEUED' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
