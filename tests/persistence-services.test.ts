import { describe, expect, it } from 'vitest';

import type {
  ArchiveMarker,
  AuditEvent,
  IdempotencyRecord,
  SourceRecord,
  SourceRecordLink,
  UUID,
} from '../domain/persistence/models';
import type {
  ArchiveMarkerRepository,
  AuditEventRepository,
  IdempotencyRecordRepository,
  Page,
  PageRequest,
  SessionVersionRepository,
  SourceRecordRepository,
  VersionConflict,
} from '../domain/persistence/repositories';
import {
  ArchiveService,
  AuditEventService,
  IdempotencyKeyConflictError,
  IdempotencyService,
  ImmutableVersionService,
  PersistenceActionService,
  SourceRecordService,
  createExternalStepIdempotencyKey,
} from '../domain/persistence/services';

interface TestVersion {
  readonly id: UUID;
  readonly sessionId: UUID;
  readonly version: number;
  readonly contentHash: string;
  readonly createdAt: Date;
  readonly createdBy: UUID | 'SYSTEM';
  readonly payload: string;
}

class InMemoryVersionRepository implements SessionVersionRepository<TestVersion> {
  readonly records: TestVersion[] = [];

  async create(input: Omit<TestVersion, 'id' | 'createdAt' | 'createdBy'>): Promise<TestVersion> {
    if (
      this.records.some(
        (record) => record.sessionId === input.sessionId && record.version === input.version,
      )
    ) {
      throw new Error('unique version constraint');
    }
    const record = {
      ...input,
      id: `version-${this.records.length + 1}`,
      createdAt: new Date(),
      createdBy: 'SYSTEM' as const,
    };
    this.records.push(record);
    return record;
  }

  async getById(id: UUID): Promise<TestVersion | null> {
    return this.records.find((record) => record.id === id) ?? null;
  }

  async getBySessionVersion(sessionId: UUID, version: number): Promise<TestVersion | null> {
    return (
      this.records.find((record) => record.sessionId === sessionId && record.version === version) ??
      null
    );
  }

  async getLatestBySession(sessionId: UUID): Promise<TestVersion | null> {
    return (
      this.records
        .filter((record) => record.sessionId === sessionId)
        .sort((left, right) => right.version - left.version)[0] ?? null
    );
  }

  async listBySession(sessionId: UUID, page: PageRequest): Promise<Page<TestVersion>> {
    return {
      items: this.records.filter((record) => record.sessionId === sessionId).slice(0, page.limit),
    };
  }
}

class InMemorySourceRepository implements SourceRecordRepository {
  readonly records = new Map<UUID, SourceRecord>();
  readonly links: SourceRecordLink[] = [];

  async create(input: Omit<SourceRecord, 'id' | 'createdAt' | 'createdBy'>): Promise<SourceRecord> {
    const record: SourceRecord = {
      ...input,
      id: `source-${this.records.size + 1}`,
      createdAt: new Date(),
      createdBy: 'SYSTEM',
    };
    this.records.set(record.id, record);
    return record;
  }

  async getById(id: UUID): Promise<SourceRecord | null> {
    return this.records.get(id) ?? null;
  }

  async listForEntity(
    entityType: string,
    entityId: UUID,
    page: PageRequest,
  ): Promise<Page<SourceRecord>> {
    const ids = new Set(
      this.links
        .filter((link) => link.entityType === entityType && link.entityId === entityId)
        .map((link) => link.sourceRecordId),
    );
    return {
      items: [...this.records.values()].filter((record) => ids.has(record.id)).slice(0, page.limit),
    };
  }

  async link(input: SourceRecordLink): Promise<void> {
    if (!this.links.some((link) => JSON.stringify(link) === JSON.stringify(input)))
      this.links.push(input);
  }

  async linkMany(input: {
    readonly sourceRecordIds: readonly UUID[];
    readonly entityType: string;
    readonly entityId: UUID;
    readonly role: string;
  }): Promise<void> {
    for (const sourceRecordId of input.sourceRecordIds) {
      await this.link({
        sourceRecordId,
        entityType: input.entityType,
        entityId: input.entityId,
        role: input.role,
      });
    }
  }

  async listLinks(entityType: string, entityId: UUID): Promise<readonly SourceRecordLink[]> {
    return this.links.filter(
      (link) => link.entityType === entityType && link.entityId === entityId,
    );
  }
}

class InMemoryAuditRepository implements AuditEventRepository {
  readonly events: AuditEvent[] = [];

  async append(input: Omit<AuditEvent, 'id' | 'createdAt' | 'createdBy'>): Promise<AuditEvent> {
    const event: AuditEvent = {
      ...input,
      id: `audit-${this.events.length + 1}`,
      createdAt: new Date(),
      createdBy: 'SYSTEM',
    };
    this.events.push(event);
    return event;
  }

  async getByEntity(
    entityType: string,
    entityId: UUID,
    page: PageRequest,
  ): Promise<Page<AuditEvent>> {
    return {
      items: this.events
        .filter((event) => event.entityType === entityType && event.entityId === entityId)
        .slice(0, page.limit),
    };
  }

  async getByTraceId(traceId: string, page: PageRequest): Promise<Page<AuditEvent>> {
    return { items: this.events.filter((event) => event.traceId === traceId).slice(0, page.limit) };
  }
}

class InMemoryIdempotencyRepository implements IdempotencyRecordRepository {
  readonly records = new Map<UUID, IdempotencyRecord>();
  readonly byKey = new Map<string, UUID>();

  async create(
    input: Omit<IdempotencyRecord, 'id' | 'createdAt' | 'createdBy'>,
  ): Promise<IdempotencyRecord> {
    if (this.byKey.has(input.idempotencyKey)) throw new Error('unique idempotency constraint');
    const record: IdempotencyRecord = {
      ...input,
      id: `idempotency-${this.records.size + 1}`,
      createdAt: new Date(),
      createdBy: 'SYSTEM',
    };
    this.records.set(record.id, record);
    this.byKey.set(record.idempotencyKey, record.id);
    return record;
  }

  async getByKey(idempotencyKey: string): Promise<IdempotencyRecord | null> {
    const id = this.byKey.get(idempotencyKey);
    return id ? (this.records.get(id) ?? null) : null;
  }

  async complete(
    id: UUID,
    input: {
      readonly expectedVersion: number;
      readonly resultEntityId: UUID;
      readonly resultVersion?: number;
      readonly completedAt?: Date;
    },
  ): Promise<IdempotencyRecord | VersionConflict> {
    const current = this.records.get(id);
    if (!current) throw new Error('idempotency record not found');
    if (current.version !== input.expectedVersion) {
      return {
        entityId: id,
        expectedVersion: input.expectedVersion,
        actualVersion: current.version,
      };
    }
    const next: IdempotencyRecord = {
      ...current,
      status: 'COMPLETED',
      resultEntityId: input.resultEntityId,
      resultVersion: input.resultVersion,
      completedAt: input.completedAt ?? new Date(),
      version: current.version + 1,
    };
    this.records.set(id, next);
    return next;
  }
}

class InMemoryArchiveRepository implements ArchiveMarkerRepository {
  readonly markers = new Map<string, ArchiveMarker>();

  async markArchived(
    input: Omit<ArchiveMarker, 'archivedAt'> & { readonly archivedAt?: Date },
  ): Promise<ArchiveMarker> {
    const marker = { ...input, archivedAt: input.archivedAt ?? new Date() };
    this.markers.set(`${input.entityType}:${input.entityId}`, marker);
    return marker;
  }

  async get(entityType: string, entityId: UUID): Promise<ArchiveMarker | null> {
    return this.markers.get(`${entityType}:${entityId}`) ?? null;
  }
}

function sourceInput(
  sourceRef: string,
  parentSourceRecordIds: readonly UUID[] = [],
): Omit<SourceRecord, 'id' | 'createdAt' | 'createdBy'> {
  return {
    sourceType: 'MANUAL_INPUT',
    sourceRef,
    version: 1,
    contentHash: `hash-${sourceRef}`,
    capturedAt: new Date(),
    operatorId: 'operator-1',
    parentSourceRecordIds,
    accessLimitations: [],
    redactionStatus: 'NOT_REQUIRED',
  };
}

describe('persistence domain services', () => {
  it('appends immutable session versions and rejects stale expectedVersion writes', async () => {
    const repository = new InMemoryVersionRepository();
    const service = new ImmutableVersionService();
    const first = await service.append({
      repository,
      sessionId: 'session-1',
      expectedVersion: 0,
      input: { contentHash: 'hash-1', payload: 'first' },
    });

    expect(first.version).toBe(1);
    await expect(
      service.append({
        repository,
        sessionId: 'session-1',
        expectedVersion: 0,
        input: { contentHash: 'hash-stale', payload: 'stale' },
      }),
    ).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      expectedVersion: 0,
      actualVersion: 1,
      entityId: 'session-1',
    });

    const second = await service.append({
      repository,
      sessionId: 'session-1',
      expectedVersion: 1,
      input: { contentHash: 'hash-2', payload: 'second' },
    });
    expect(second.version).toBe(2);
    expect(repository.records.map((record) => record.payload)).toEqual(['first', 'second']);
  });

  it('creates a stable job/version/step key and deduplicates concurrent retries', async () => {
    const repository = new InMemoryIdempotencyRepository();
    const service = new IdempotencyService(repository);
    const input = {
      jobId: 'job-1',
      inputVersion: 3,
      step: 'generate',
      entityId: 'draft-1',
    } as const;

    expect(createExternalStepIdempotencyKey(input)).toBe('job-1:v3:generate');
    const first = await service.claim(input);
    const duplicate = await service.claim(input);
    expect(first.idempotent).toBe(false);
    expect(duplicate).toEqual({ record: first.record, idempotent: true });

    const completed = await service.complete({
      record: first.record,
      expectedVersion: 1,
      resultEntityId: 'draft-version-1',
      resultVersion: 1,
    });
    expect(completed.status).toBe('COMPLETED');
    expect((await service.claim(input)).record.resultEntityId).toBe('draft-version-1');

    await expect(service.claim({ ...input, entityId: 'other-entity' })).rejects.toBeInstanceOf(
      IdempotencyKeyConflictError,
    );
  });

  it('creates parent Source_Records, links them to entities, and audits all supported workflow actions', async () => {
    const sourceRepository = new InMemorySourceRepository();
    const auditRepository = new InMemoryAuditRepository();
    const sources = new SourceRecordService(sourceRepository);
    const audits = new AuditEventService(auditRepository, sourceRepository);
    const actions = new PersistenceActionService(sources, audits);
    const parent = await sources.create(sourceInput('brief-field:subject'));
    const entityId = 'draft-1';

    const actionNames = [
      'MANUAL_EDIT',
      'GENERATION',
      'ACCESS',
      'METRICS',
      'COMPLIANCE',
      'CONFIRMATION',
      'EXPORT',
      'FALLBACK',
    ] as const;
    for (const action of actionNames) {
      await actions.record({
        action,
        entityType: 'COPY_DRAFT',
        entityId,
        sourceRole: action,
        source: sourceInput(`action:${action}`, [parent.id]),
        actorType: action === 'GENERATION' ? 'MODEL' : 'OPERATOR',
        actorId: 'operator-1',
        beforeHash: action === 'MANUAL_EDIT' ? 'before' : undefined,
        afterHash: 'after',
        reason: `reason-${action}`,
        resultStatus: 'RECORDED',
        providerId: action === 'GENERATION' ? 'openrouter' : undefined,
        modelId: action === 'GENERATION' ? 'model-free' : undefined,
        toolId: action === 'ACCESS' ? 'opencli' : undefined,
        traceId: 'trace-1',
      });
    }

    const linked = await sources.getForEntity('COPY_DRAFT', entityId);
    const traceEvents = await audits.getForTrace('trace-1');
    expect(linked.items).toHaveLength(actionNames.length);
    expect(traceEvents.items.map((event) => event.action)).toEqual([...actionNames]);
    expect(traceEvents.items.find((event) => event.action === 'GENERATION')).toMatchObject({
      providerId: 'openrouter',
      modelId: 'model-free',
    });
    expect(traceEvents.items.find((event) => event.action === 'ACCESS')?.toolId).toBe('opencli');
    expect((await sourceRepository.getById(linked.items[0]!.id))!.parentSourceRecordIds).toEqual([
      parent.id,
    ]);
  });

  it('soft-archives through a marker and audit event without deleting history', async () => {
    const sourceRepository = new InMemorySourceRepository();
    const auditRepository = new InMemoryAuditRepository();
    const actions = new PersistenceActionService(
      new SourceRecordService(sourceRepository),
      new AuditEventService(auditRepository, sourceRepository),
    );
    const archives = new InMemoryArchiveRepository();
    const service = new ArchiveService(archives, actions);
    const archivedEntity = await service.archive({
      entityType: 'INSIGHT_MEMORY',
      entityId: 'memory-1',
      expectedVersion: 1,
      archive: async (expectedVersion) => {
        expect(expectedVersion).toBe(1);
        return { id: 'memory-1', status: 'ARCHIVED' };
      },
      action: {
        source: sourceInput('archive:memory-1'),
        actorType: 'OPERATOR',
        actorId: 'operator-1',
        reason: 'No longer current',
        resultStatus: 'ARCHIVED',
        traceId: 'trace-archive',
      },
    });

    expect(archivedEntity).toEqual({ id: 'memory-1', status: 'ARCHIVED' });
    expect(await archives.get('INSIGHT_MEMORY', 'memory-1')).toMatchObject({
      entityId: 'memory-1',
    });
    expect(
      (await auditRepository.getByEntity('INSIGHT_MEMORY', 'memory-1', { limit: 10 })).items[0],
    ).toMatchObject({
      action: 'ARCHIVE',
      resultStatus: 'ARCHIVED',
    });
  });
});
