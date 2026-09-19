import type {
  AuditActorType,
  AuditEvent,
  IdempotencyRecord,
  SessionVersionIdentity,
  SourceRecord,
  SourceRecordLink,
  UUID,
} from './models';
import {
  sanitizeAuditEventWrite,
  sanitizeSourceRecordWrite,
} from '../security/redaction';
import type {
  ArchiveMarkerRepository,
  AuditEventRepository,
  IdempotencyRecordRepository,
  NewImmutableVersion,
  SessionVersionRepository,
  SourceRecordRepository,
  VersionConflict,
} from './repositories';

export class PersistenceVersionConflictError extends Error {
  readonly code = 'VERSION_CONFLICT' as const;

  constructor(
    readonly entityId: UUID,
    readonly expectedVersion: number,
    readonly actualVersion: number,
  ) {
    super('The record was changed by another operation. Reload the current version and retry.');
    this.name = 'PersistenceVersionConflictError';
  }
}

export class PersistenceValidationError extends Error {
  readonly code = 'PERSISTENCE_VALIDATION_FAILED' as const;

  constructor(message: string) {
    super(message);
    this.name = 'PersistenceValidationError';
  }
}

export class IdempotencyKeyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_KEY_CONFLICT' as const;

  constructor(readonly idempotencyKey: string) {
    super('The idempotency key is already associated with different operation inputs.');
    this.name = 'IdempotencyKeyConflictError';
  }
}

export type SessionVersionWrite<T extends SessionVersionIdentity> = Omit<
  NewImmutableVersion<T>,
  'sessionId' | 'version'
>;

/**
 * Appends a new immutable session version only when the caller still owns the
 * expected version. Repository uniqueness constraints remain the final race
 * protection for two concurrent writers.
 */
export class ImmutableVersionService {
  async append<T extends SessionVersionIdentity>(input: {
    readonly repository: SessionVersionRepository<T>;
    readonly sessionId: UUID;
    readonly expectedVersion: number;
    readonly input: SessionVersionWrite<T>;
  }): Promise<T> {
    assertNonNegativeVersion(input.expectedVersion);
    const latest = await input.repository.getLatestBySession(input.sessionId);
    const actualVersion = latest?.version ?? 0;

    if (actualVersion !== input.expectedVersion) {
      throw new PersistenceVersionConflictError(
        input.sessionId,
        input.expectedVersion,
        actualVersion,
      );
    }

    return input.repository.create({
      ...input.input,
      sessionId: input.sessionId,
      version: input.expectedVersion + 1,
    } as NewImmutableVersion<T>);
  }
}

export interface ExternalStepKey {
  readonly jobId: UUID;
  readonly inputVersion: number;
  readonly step: string;
  readonly entityId: UUID;
}

export function createExternalStepIdempotencyKey(input: ExternalStepKey): string {
  assertRequiredText(input.jobId, 'jobId');
  assertPositiveVersion(input.inputVersion, 'inputVersion');
  assertRequiredText(input.entityId, 'entityId');
  assertRequiredText(input.step, 'step');

  if (!/^[A-Za-z0-9._-]+$/.test(input.step)) {
    throw new PersistenceValidationError('step contains unsupported characters');
  }

  return `${input.jobId}:v${input.inputVersion}:${input.step}`;
}

export class IdempotencyService {
  constructor(private readonly repository: IdempotencyRecordRepository) {}

  async claim(input: ExternalStepKey): Promise<{
    readonly record: IdempotencyRecord;
    readonly idempotent: boolean;
  }> {
    const idempotencyKey = createExternalStepIdempotencyKey(input);
    const existing = await this.repository.getByKey(idempotencyKey);
    if (existing) {
      assertSameOperation(existing, input, idempotencyKey);
      return { record: existing, idempotent: true };
    }

    const recordInput: Omit<IdempotencyRecord, 'id' | 'createdAt' | 'createdBy'> = {
      idempotencyKey,
      jobId: input.jobId,
      inputVersion: input.inputVersion,
      step: input.step,
      entityId: input.entityId,
      status: 'IN_PROGRESS',
      version: 1,
    };

    try {
      const record = await this.repository.create(recordInput);
      return { record, idempotent: false };
    } catch (error) {
      // A concurrent claimant may win the unique-key insert between the read
      // and create. Resolve that race as a duplicate instead of retrying work.
      const raced = await this.repository.getByKey(idempotencyKey);
      if (!raced) throw error;
      assertSameOperation(raced, input, idempotencyKey);
      return { record: raced, idempotent: true };
    }
  }

  async complete(input: {
    readonly record: IdempotencyRecord;
    readonly expectedVersion: number;
    readonly resultEntityId: UUID;
    readonly resultVersion?: number;
    readonly completedAt?: Date;
  }): Promise<IdempotencyRecord> {
    const completed = await this.repository.complete(input.record.id, {
      expectedVersion: input.expectedVersion,
      resultEntityId: input.resultEntityId,
      resultVersion: input.resultVersion,
      completedAt: input.completedAt,
    });
    if (isVersionConflict(completed)) {
      throw new PersistenceVersionConflictError(
        completed.entityId,
        completed.expectedVersion,
        completed.actualVersion,
      );
    }
    return completed;
  }
}

export type SourceRecordWrite = Omit<SourceRecord, 'id' | 'createdAt' | 'createdBy'>;

export class SourceRecordService {
  constructor(private readonly repository: SourceRecordRepository) {}

  async create(input: SourceRecordWrite): Promise<SourceRecord> {
    assertRequiredText(input.sourceRef, 'sourceRef');
    assertPositiveVersion(input.version, 'source version');
    const parentSourceRecordIds = uniqueIds(input.parentSourceRecordIds);

    for (const parentId of parentSourceRecordIds) {
      if (!(await this.repository.getById(parentId))) {
        throw new PersistenceValidationError(`Parent Source_Record does not exist: ${parentId}`);
      }
    }

    return this.repository.create(
      sanitizeSourceRecordWrite({
        ...input,
        parentSourceRecordIds,
      }),
    );
  }

  async createAndLink(input: {
    readonly record: SourceRecordWrite;
    readonly link: Omit<SourceRecordLink, 'sourceRecordId'>;
  }): Promise<SourceRecord> {
    const record = await this.create(input.record);
    await this.link({
      sourceRecordId: record.id,
      entityType: input.link.entityType,
      entityId: input.link.entityId,
      role: input.link.role,
    });
    return record;
  }

  async link(input: SourceRecordLink): Promise<void> {
    if (!(await this.repository.getById(input.sourceRecordId))) {
      throw new PersistenceValidationError(`Source_Record does not exist: ${input.sourceRecordId}`);
    }
    assertRequiredText(input.entityType, 'entityType');
    assertRequiredText(input.entityId, 'entityId');
    assertRequiredText(input.role, 'source link role');
    await this.repository.link(input);
  }

  async linkMany(input: {
    readonly sourceRecordIds: readonly UUID[];
    readonly entityType: string;
    readonly entityId: UUID;
    readonly role: string;
  }): Promise<void> {
    const sourceRecordIds = uniqueIds(input.sourceRecordIds);
    for (const sourceRecordId of sourceRecordIds) {
      if (!(await this.repository.getById(sourceRecordId))) {
        throw new PersistenceValidationError(`Source_Record does not exist: ${sourceRecordId}`);
      }
    }
    assertRequiredText(input.entityType, 'entityType');
    assertRequiredText(input.entityId, 'entityId');
    assertRequiredText(input.role, 'source link role');
    await this.repository.linkMany({ ...input, sourceRecordIds });
  }

  getForEntity(entityType: string, entityId: UUID, limit = 100) {
    return this.repository.listForEntity(entityType, entityId, { limit });
  }

  getLinksForEntity(entityType: string, entityId: UUID) {
    return this.repository.listLinks(entityType, entityId);
  }
}

export type AuditEventWrite = Omit<AuditEvent, 'id' | 'createdAt' | 'createdBy'>;

export class AuditEventService {
  constructor(
    private readonly repository: AuditEventRepository,
    private readonly sourceRecords?: SourceRecordRepository,
  ) {}

  async append(input: AuditEventWrite): Promise<AuditEvent> {
    assertRequiredText(input.action, 'audit action');
    assertRequiredText(input.entityType, 'audit entityType');
    assertRequiredText(input.entityId, 'audit entityId');
    assertRequiredText(input.resultStatus, 'audit resultStatus');
    assertRequiredText(input.traceId, 'traceId');

    if (
      input.sourceRecordId &&
      this.sourceRecords &&
      !(await this.sourceRecords.getById(input.sourceRecordId))
    ) {
      throw new PersistenceValidationError(
        `Audit Source_Record does not exist: ${input.sourceRecordId}`,
      );
    }

    return this.repository.append(sanitizeAuditEventWrite(input));
  }

  getForEntity(entityType: string, entityId: UUID, limit = 100) {
    return this.repository.getByEntity(entityType, entityId, { limit });
  }

  getForTrace(traceId: string, limit = 100) {
    assertRequiredText(traceId, 'traceId');
    return this.repository.getByTraceId(traceId, { limit });
  }
}

export const PERSISTENCE_ACTIONS = [
  'MANUAL_EDIT',
  'GENERATION',
  'ACCESS',
  'METRICS',
  'COMPLIANCE',
  'CONFIRMATION',
  'EXPORT',
  'FALLBACK',
  'ARCHIVE',
] as const;

export type PersistenceAction = (typeof PERSISTENCE_ACTIONS)[number];

export class PersistenceActionService {
  constructor(
    private readonly sourceRecords: SourceRecordService,
    private readonly auditEvents: AuditEventService,
  ) {}

  async record(input: {
    readonly action: PersistenceAction;
    readonly entityType: string;
    readonly entityId: UUID;
    readonly source: SourceRecordWrite;
    readonly sourceRole?: string;
    readonly actorType: AuditActorType;
    readonly actorId?: UUID;
    readonly beforeHash?: string;
    readonly afterHash?: string;
    readonly reason?: string;
    readonly resultStatus: string;
    readonly providerId?: string;
    readonly modelId?: string;
    readonly toolId?: string;
    readonly traceId: string;
  }): Promise<{ readonly sourceRecord: SourceRecord; readonly auditEvent: AuditEvent }> {
    const sourceRecord = await this.sourceRecords.createAndLink({
      record: input.source,
      link: {
        entityType: input.entityType,
        entityId: input.entityId,
        role: input.sourceRole ?? input.action,
      },
    });
    const auditEvent = await this.auditEvents.append({
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeHash: input.beforeHash,
      afterHash: input.afterHash,
      reason: input.reason,
      resultStatus: input.resultStatus,
      sourceRecordId: sourceRecord.id,
      providerId: input.providerId,
      modelId: input.modelId,
      toolId: input.toolId,
      traceId: input.traceId,
    });
    return { sourceRecord, auditEvent };
  }
}

export class ArchiveService {
  constructor(
    private readonly archives: ArchiveMarkerRepository,
    private readonly actions: PersistenceActionService,
  ) {}

  async archive<T>(input: {
    readonly entityType: string;
    readonly entityId: UUID;
    readonly expectedVersion: number;
    readonly archive: (expectedVersion: number) => Promise<T | VersionConflict>;
    readonly action: Omit<
      Parameters<PersistenceActionService['record']>[0],
      'action' | 'entityType' | 'entityId'
    >;
  }): Promise<T> {
    const result = await input.archive(input.expectedVersion);
    if (isVersionConflict(result)) {
      throw new PersistenceVersionConflictError(
        result.entityId,
        result.expectedVersion,
        result.actualVersion,
      );
    }

    await this.archives.markArchived({
      entityType: input.entityType,
      entityId: input.entityId,
      archivedBy: input.action.actorId,
    });
    await this.actions.record({
      ...input.action,
      action: 'ARCHIVE',
      entityType: input.entityType,
      entityId: input.entityId,
      resultStatus: input.action.resultStatus || 'ARCHIVED',
    });
    return result;
  }
}

function assertSameOperation(
  record: IdempotencyRecord,
  input: ExternalStepKey,
  idempotencyKey: string,
): void {
  if (
    record.jobId !== input.jobId ||
    record.inputVersion !== input.inputVersion ||
    record.step !== input.step ||
    record.entityId !== input.entityId
  ) {
    throw new IdempotencyKeyConflictError(idempotencyKey);
  }
}

function assertRequiredText(value: string, name: string): void {
  if (!value.trim()) throw new PersistenceValidationError(`${name} is required`);
}

function assertPositiveVersion(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new PersistenceValidationError(`${name} must be a positive integer`);
  }
}

function assertNonNegativeVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PersistenceValidationError('expectedVersion must be a non-negative integer');
  }
}

function uniqueIds(ids: readonly UUID[]): UUID[] {
  return [...new Set(ids)];
}

function isVersionConflict(value: unknown): value is VersionConflict {
  return (
    typeof value === 'object' &&
    value !== null &&
    'expectedVersion' in value &&
    'actualVersion' in value &&
    'entityId' in value
  );
}
