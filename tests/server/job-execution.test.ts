import { describe, expect, it } from 'vitest';
import type { AuditEvent, IdempotencyRecord, Job, UUID } from '../../domain/persistence/models';
import type { AuditEventRepository, IdempotencyRecordRepository, JobRepository, PageRequest, Page, VersionConflict } from '../../domain/persistence/repositories';
import { AuditEventService, IdempotencyService } from '../../domain/persistence/services';
import { DurableJobExecutor } from '../../server/jobs/execution';
import { JobService } from '../../server/jobs/service';

class Jobs implements JobRepository {
  records = new Map<UUID, Job>();
  async create(input: Omit<Job, 'id' | 'createdAt' | 'createdBy' | 'updatedAt'>) { const now = new Date(); const job = { ...input, id: 'job-1', createdAt: now, updatedAt: now, createdBy: 'SYSTEM' as const }; this.records.set(job.id, job); return job; }
  async getById(id: UUID) { return this.records.get(id) ?? null; }
  async getByIdempotencyKey(key: string) { return [...this.records.values()].find((job) => job.idempotencyKey === key) ?? null; }
  async update(id: UUID, input: Parameters<JobRepository['update']>[1]): Promise<Job | VersionConflict> { const current = this.records.get(id)!; if (current.version !== input.expectedVersion) return { entityId: id, expectedVersion: input.expectedVersion, actualVersion: current.version }; const next = { ...current, ...input, version: current.version + 1, updatedAt: new Date() }; delete (next as { expectedVersion?: number }).expectedVersion; this.records.set(id, next); return next; }
}
class Idempotency implements IdempotencyRecordRepository {
  records = new Map<string, IdempotencyRecord>();
  async create(input: Omit<IdempotencyRecord, 'id' | 'createdAt' | 'createdBy'>) { const record = { ...input, id: `idem-${this.records.size + 1}`, createdAt: new Date(), createdBy: 'SYSTEM' as const }; this.records.set(record.idempotencyKey, record); return record; }
  async getByKey(key: string) { return this.records.get(key) ?? null; }
  async complete(id: UUID, input: Parameters<IdempotencyRecordRepository['complete']>[1]) { const record = [...this.records.values()].find((value) => value.id === id)!; if (record.version !== input.expectedVersion) return { entityId: id, expectedVersion: input.expectedVersion, actualVersion: record.version }; const next = { ...record, ...input, status: 'COMPLETED' as const, version: record.version + 1, completedAt: input.completedAt ?? new Date() }; delete (next as { expectedVersion?: number }).expectedVersion; this.records.set(next.idempotencyKey, next); return next; }
}
class Audit implements AuditEventRepository {
  events: AuditEvent[] = [];
  async append(input: Omit<AuditEvent, 'id' | 'createdAt' | 'createdBy'>) { const event = { ...input, id: `audit-${this.events.length + 1}`, createdAt: new Date(), createdBy: 'SYSTEM' as const }; this.events.push(event); return event; }
  async getByEntity(entityType: string, entityId: UUID, page: PageRequest): Promise<Page<AuditEvent>> { return { items: this.events.filter((event) => event.entityType === entityType && event.entityId === entityId).slice(0, page.limit) }; }
  async getByTraceId(traceId: string, page: PageRequest): Promise<Page<AuditEvent>> { return { items: this.events.filter((event) => event.traceId === traceId).slice(0, page.limit) }; }
}

describe('DurableJobExecutor', () => {
  it('awaits work, persists the external-step claim, audit, and survives a repeated execution', async () => {
    const jobs = new Jobs();
    const idempotency = new Idempotency();
    const audit = new Audit();
    const jobService = new JobService(jobs);
    const executor = new DurableJobExecutor({ jobs, idempotency: new IdempotencyService(idempotency), jobService, audit: new AuditEventService(audit) });
    const created = await jobService.create({ operatorId: 'operator-1', kind: 'REVIEW_EVALUATION', entityId: 'review-1', inputVersion: 2, idempotencyKey: 'review-2' });
    let calls = 0;
    const handler = async () => { calls += 1; return { resultEntityId: 'result-1', resultVersion: 1, sourceRecordId: 'source-1' }; };

    const first = await executor.execute({ jobId: created.job.id, step: 'evaluate', traceId: 'trace-1', handler });
    const second = await executor.execute({ jobId: created.job.id, step: 'evaluate', traceId: 'trace-2', handler });

    expect(first.status).toBe('SUCCEEDED');
    expect(second.status).toBe('SUCCEEDED');
    expect(calls).toBe(1);
    expect(idempotency.records.get('job-1:v2:evaluate')).toMatchObject({ status: 'COMPLETED', resultEntityId: 'result-1' });
    expect(audit.events.map((event) => event.resultStatus)).toEqual(['SUCCEEDED', 'IDEMPOTENT_REPLAY']);
  });
});
