import 'server-only';

import type { Job, UUID } from '@/domain/persistence/models';
import {
  AuditEventService,
  IdempotencyService,
  PersistenceActionService,
  createExternalStepIdempotencyKey,
} from '@/domain/persistence/services';
import type { JobRepository } from '@/domain/persistence/repositories';
import { JobService } from './service';

export type DurableJobHandler = (input: {
  readonly job: Job;
  readonly idempotencyKey: string;
  readonly traceId: string;
}) => Promise<{ readonly resultEntityId?: UUID; readonly resultVersion?: number; readonly sourceRecordId?: UUID }>;

export type DurableJobExecutionDependencies = {
  readonly jobs: JobRepository;
  readonly idempotency: IdempotencyService;
  readonly jobService: JobService;
  readonly audit?: AuditEventService;
  readonly actions?: PersistenceActionService;
};

/**
 * Executes one persisted job attempt. It deliberately does not detach work from
 * the request: Vercel may terminate a function after the response, so callers
 * must await this method or use a real queue/worker adapter.
 */
export class DurableJobExecutor {
  constructor(private readonly dependencies: DurableJobExecutionDependencies) {}

  async execute(input: {
    readonly jobId: UUID;
    readonly step: string;
    readonly traceId: string;
    readonly handler: DurableJobHandler;
  }): Promise<Job> {
    const job = await this.dependencies.jobs.getById(input.jobId);
    if (!job) throw new Error('JOB_NOT_FOUND');

    if (job.status === 'SUCCEEDED' || job.status === 'TERMINAL_FAILURE') {
      await this.recordAudit(job, input.traceId, 'IDEMPOTENT_REPLAY');
      return job;
    }
    if (job.status === 'RETRYABLE_FAILURE') await this.dependencies.jobService.start(job.id);
    else if (job.status === 'QUEUED') await this.dependencies.jobService.start(job.id);

    const running = await this.dependencies.jobs.getById(job.id);
    if (!running) throw new Error('JOB_NOT_FOUND');
    const claim = await this.dependencies.idempotency.claim({
      jobId: running.id,
      inputVersion: running.inputVersion,
      step: input.step,
      entityId: running.entityId,
    });

    if (claim.idempotent && claim.record.status === 'COMPLETED') {
      const succeeded = await this.dependencies.jobService.succeed({
        jobId: running.id,
        sourceRecordId: claim.record.resultEntityId,
      });
      await this.recordAudit(succeeded, input.traceId, 'IDEMPOTENT_REPLAY');
      return succeeded;
    }

    try {
      const result = await input.handler({
        job: running,
        idempotencyKey: createExternalStepIdempotencyKey({
          jobId: running.id,
          inputVersion: running.inputVersion,
          step: input.step,
          entityId: running.entityId,
        }),
        traceId: input.traceId,
      });
      await this.dependencies.idempotency.complete({
        record: claim.record,
        expectedVersion: claim.record.version,
        resultEntityId: result.resultEntityId ?? running.entityId,
        resultVersion: result.resultVersion,
      });
      const succeeded = await this.dependencies.jobService.succeed({
        jobId: running.id,
        sourceRecordId: result.sourceRecordId,
      });
      await this.recordAudit(succeeded, input.traceId, 'SUCCEEDED', result.sourceRecordId);
      return succeeded;
    } catch (error) {
      const failure = await this.dependencies.jobService.fail({
        jobId: running.id,
        sourceRecordId: undefined,
        failure: {
          code: error instanceof Error ? error.name : 'JOB_EXECUTION_FAILED',
        },
      });
      await this.recordAudit(failure, input.traceId, failure.status);
      return failure;
    }
  }

  private async recordAudit(job: Job, traceId: string, resultStatus: string, sourceRecordId?: UUID) {
    if (this.dependencies.audit) {
      await this.dependencies.audit.append({
        actorType: 'SYSTEM',
        action: 'GENERATION',
        entityType: 'JOB',
        entityId: job.id,
        resultStatus,
        sourceRecordId: sourceRecordId ?? job.sourceRecordId,
        traceId,
      });
    }
  }
}
