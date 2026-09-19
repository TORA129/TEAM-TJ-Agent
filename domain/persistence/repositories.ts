import type {
  AccessAuthorizationConfirmation,
  AccessibleContent,
  ArchiveMarker,
  AuditEvent,
  BlockedTermListVersion,
  ComplianceResult,
  ContentBriefVersion,
  CopyDraftVersion,
  CoverAsset,
  CoverBrief,
  IdempotencyRecord,
  ImmutableVersionIdentity,
  SessionVersionIdentity,
  InsightMemory,
  Job,
  ManualContentInput,
  MetricThresholdSet,
  MetricValue,
  OperatorSettings,
  QuestionSet,
  ReviewInsight,
  ReviewResultVersion,
  SourceRecord,
  SourceRecordLink,
  SupplementaryFile,
  SupplementaryFileManualAction,
  UUID,
  WorkflowSession,
} from './models';

export interface VersionConflict {
  readonly expectedVersion: number;
  readonly actualVersion: number;
  readonly entityId: UUID;
}

export interface ExpectedVersion {
  readonly expectedVersion: number;
}

export interface PageRequest {
  readonly limit: number;
  readonly cursor?: string;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
}

export type NewRecord<T extends { id: UUID; createdAt: Date; createdBy: unknown }> = Omit<
  T,
  'id' | 'createdAt' | 'createdBy'
>;
export type NewImmutableVersion<T extends ImmutableVersionIdentity> = Omit<
  T,
  'id' | 'createdAt' | 'createdBy'
>;

export interface WorkflowSessionRepository {
  create(input: {
    readonly operatorId: UUID;
    readonly kind: WorkflowSession['kind'];
    readonly status: WorkflowSession['status'];
  }): Promise<WorkflowSession>;
  getById(id: UUID): Promise<WorkflowSession | null>;
  listByOperator(operatorId: UUID, page: PageRequest): Promise<Page<WorkflowSession>>;
  updateStatus(
    id: UUID,
    input: ExpectedVersion & {
      readonly status: WorkflowSession['status'];
      readonly currentVersion?: number;
    },
  ): Promise<WorkflowSession | VersionConflict>;
  archive(id: UUID, input: ExpectedVersion): Promise<WorkflowSession | VersionConflict>;
}

export interface SessionVersionRepository<T extends SessionVersionIdentity> {
  create(input: NewImmutableVersion<T>): Promise<T>;
  getById(id: UUID): Promise<T | null>;
  getBySessionVersion(sessionId: UUID, version: number): Promise<T | null>;
  getLatestBySession(sessionId: UUID): Promise<T | null>;
  listBySession(sessionId: UUID, page: PageRequest): Promise<Page<T>>;
}

export type ContentBriefVersionRepository = SessionVersionRepository<ContentBriefVersion>;
export type CopyDraftVersionRepository = SessionVersionRepository<CopyDraftVersion>;
export type CoverBriefRepository = SessionVersionRepository<CoverBrief>;
export type ManualContentInputRepository = SessionVersionRepository<ManualContentInput>;
export type ReviewResultVersionRepository = SessionVersionRepository<ReviewResultVersion>;
export type ReviewInsightRepository = SessionVersionRepository<ReviewInsight>;

export interface QuestionSetRepository {
  create(input: Omit<QuestionSet, 'id' | 'createdAt' | 'createdBy'>): Promise<QuestionSet>;
  getById(id: UUID): Promise<QuestionSet | null>;
  getOpenForBrief(sessionId: UUID, briefVersion: number): Promise<QuestionSet | null>;
  answer(
    id: UUID,
    input: ExpectedVersion & {
      readonly answers: QuestionSet['answers'];
      readonly status: Extract<QuestionSet['status'], 'OPEN' | 'ANSWERED' | 'DECLINED'>;
      readonly answeredAt?: Date;
    },
  ): Promise<QuestionSet | VersionConflict>;
}

export interface SupplementaryFileRepository {
  create(
    input: Omit<SupplementaryFile, 'id' | 'createdAt' | 'createdBy'>,
  ): Promise<SupplementaryFile>;
  getById(id: UUID): Promise<SupplementaryFile | null>;
  listBySession(sessionId: UUID, page: PageRequest): Promise<Page<SupplementaryFile>>;
  updateParseState(
    id: UUID,
    input: ExpectedVersion & {
      readonly parseStatus: SupplementaryFile['parseStatus'];
      readonly parseErrorCode?: string;
      readonly sourceRecordId?: UUID;
      readonly parseSourceRecordId?: UUID;
      readonly parsedContent?: string;
      readonly parsedContentHash?: string;
      readonly contentSourceRecordId?: UUID;
      readonly boundBriefVersion?: number;
      readonly manualAction?: SupplementaryFileManualAction;
      readonly manualActionSourceRecordId?: UUID;
    },
  ): Promise<SupplementaryFile | VersionConflict>;
  archive(id: UUID, input: ExpectedVersion): Promise<SupplementaryFile | VersionConflict>;
}

export interface BlockedTermListRepository {
  create(input: NewImmutableVersion<BlockedTermListVersion>): Promise<BlockedTermListVersion>;
  getById(id: UUID): Promise<BlockedTermListVersion | null>;
  listByOperator(operatorId: UUID, page: PageRequest): Promise<Page<BlockedTermListVersion>>;
  archive(id: UUID): Promise<BlockedTermListVersion | null>;
}

export interface ComplianceResultRepository {
  create(
    input: Omit<ComplianceResult, 'id' | 'createdAt' | 'createdBy'> & Partial<Pick<ComplianceResult, 'id'>>,
  ): Promise<ComplianceResult>;
  getById(id: UUID): Promise<ComplianceResult | null>;
  listForTarget(
    targetType: ComplianceResult['targetType'],
    targetVersionId: UUID,
  ): Promise<readonly ComplianceResult[]>;
}

export interface CoverAssetRepository {
  create(input: Omit<CoverAsset, 'id' | 'createdAt' | 'createdBy'>): Promise<CoverAsset>;
  getById(id: UUID): Promise<CoverAsset | null>;
  listBySession(sessionId: UUID, page: PageRequest): Promise<Page<CoverAsset>>;
  updateStatus(
    id: UUID,
    input: ExpectedVersion &
      Pick<
        CoverAsset,
        | 'status'
        | 'objectKey'
        | 'mimeType'
        | 'width'
        | 'height'
        | 'aspectRatio'
        | 'pixelHash'
        | 'failureCode'
        | 'failureMessage'
      >,
  ): Promise<CoverAsset | VersionConflict>;
  archive(id: UUID, input: ExpectedVersion): Promise<CoverAsset | VersionConflict>;
}

export interface AccessAuthorizationRepository {
  create(
    input: Omit<AccessAuthorizationConfirmation, 'id' | 'createdAt' | 'createdBy'>,
  ): Promise<AccessAuthorizationConfirmation>;
  getById(id: UUID): Promise<AccessAuthorizationConfirmation | null>;
  getValidForExactRequest(input: {
    readonly reviewId: UUID;
    readonly exactNoteUrl: string;
    readonly toolId: string;
    readonly purpose: string;
    readonly accountMode: AccessAuthorizationConfirmation['accountMode'];
    readonly at: Date;
  }): Promise<AccessAuthorizationConfirmation | null>;
  invalidate(
    id: UUID,
    input: ExpectedVersion,
  ): Promise<AccessAuthorizationConfirmation | VersionConflict>;
}

export interface AccessibleContentRepository {
  create(
    input: Omit<AccessibleContent, 'id' | 'createdAt' | 'createdBy'>,
  ): Promise<AccessibleContent>;
  getById(id: UUID): Promise<AccessibleContent | null>;
  listByReview(reviewId: UUID, page: PageRequest): Promise<Page<AccessibleContent>>;
}

export interface MetricThresholdSetRepository {
  create(input: NewImmutableVersion<MetricThresholdSet>): Promise<MetricThresholdSet>;
  getById(id: UUID): Promise<MetricThresholdSet | null>;
  getByOperatorVersion(operatorId: UUID, version: number): Promise<MetricThresholdSet | null>;
  listByOperator(operatorId: UUID, page: PageRequest): Promise<Page<MetricThresholdSet>>;
  archive(id: UUID): Promise<MetricThresholdSet | null>;
}

export interface MetricValueRepository {
  append(input: NewImmutableVersion<MetricValue>): Promise<MetricValue>;
  getById(id: UUID): Promise<MetricValue | null>;
  listByReview(reviewId: UUID, page: PageRequest): Promise<Page<MetricValue>>;
  getLatestByMetric(
    reviewId: UUID,
    metricType: MetricValue['metricType'],
  ): Promise<MetricValue | null>;
}

export interface InsightMemoryRepository {
  create(input: Omit<InsightMemory, 'id' | 'createdAt' | 'createdBy'>): Promise<InsightMemory>;
  getById(id: UUID): Promise<InsightMemory | null>;
  listByOperator(operatorId: UUID, page: PageRequest): Promise<Page<InsightMemory>>;
  archive(id: UUID, input: ExpectedVersion): Promise<InsightMemory | VersionConflict>;
}

export interface SourceRecordRepository {
  create(input: Omit<SourceRecord, 'id' | 'createdAt' | 'createdBy'>): Promise<SourceRecord>;
  getById(id: UUID): Promise<SourceRecord | null>;
  listForEntity(entityType: string, entityId: UUID, page: PageRequest): Promise<Page<SourceRecord>>;
  link(input: SourceRecordLink): Promise<void>;
  linkMany(input: {
    readonly sourceRecordIds: readonly UUID[];
    readonly entityType: string;
    readonly entityId: UUID;
    readonly role: string;
  }): Promise<void>;
  listLinks(entityType: string, entityId: UUID): Promise<readonly SourceRecordLink[]>;
}

export interface AuditEventRepository {
  append(input: Omit<AuditEvent, 'id' | 'createdAt' | 'createdBy'>): Promise<AuditEvent>;
  getByEntity(entityType: string, entityId: UUID, page: PageRequest): Promise<Page<AuditEvent>>;
  getByTraceId(traceId: string, page: PageRequest): Promise<Page<AuditEvent>>;
}

export interface JobRepository {
  create(input: Omit<Job, 'id' | 'createdAt' | 'createdBy' | 'updatedAt'>): Promise<Job>;
  getById(id: UUID): Promise<Job | null>;
  getByIdempotencyKey(idempotencyKey: string): Promise<Job | null>;
  update(
    id: UUID,
    input: ExpectedVersion &
      Partial<
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
  ): Promise<Job | VersionConflict>;
}

export interface OperatorSettingsRepository {
  getByOperator(operatorId: UUID): Promise<OperatorSettings | null>;
  upsert(
    input: Omit<OperatorSettings, 'id' | 'createdAt' | 'createdBy' | 'updatedAt'> & {
      readonly expectedVersion?: number;
    },
  ): Promise<OperatorSettings | VersionConflict>;
}

export interface ArchiveMarkerRepository {
  markArchived(
    input: Omit<ArchiveMarker, 'archivedAt'> & { readonly archivedAt?: Date },
  ): Promise<ArchiveMarker>;
  get(entityType: string, entityId: UUID): Promise<ArchiveMarker | null>;
}

export interface IdempotencyRecordRepository {
  create(
    input: Omit<IdempotencyRecord, 'id' | 'createdAt' | 'createdBy'>,
  ): Promise<IdempotencyRecord>;
  getByKey(idempotencyKey: string): Promise<IdempotencyRecord | null>;
  complete(
    id: UUID,
    input: ExpectedVersion & {
      readonly resultEntityId: UUID;
      readonly resultVersion?: number;
      readonly completedAt?: Date;
    },
  ): Promise<IdempotencyRecord | VersionConflict>;
}

export interface PersistenceRepositories {
  readonly workflowSessions: WorkflowSessionRepository;
  readonly contentBriefVersions: ContentBriefVersionRepository;
  readonly questionSets: QuestionSetRepository;
  readonly copyDraftVersions: CopyDraftVersionRepository;
  readonly supplementaryFiles: SupplementaryFileRepository;
  readonly blockedTermLists: BlockedTermListRepository;
  readonly complianceResults: ComplianceResultRepository;
  readonly coverBriefs: CoverBriefRepository;
  readonly coverAssets: CoverAssetRepository;
  readonly accessAuthorizations: AccessAuthorizationRepository;
  readonly accessibleContents: AccessibleContentRepository;
  readonly manualContentInputs: ManualContentInputRepository;
  readonly metricThresholdSets: MetricThresholdSetRepository;
  readonly metricValues: MetricValueRepository;
  readonly reviewResultVersions: ReviewResultVersionRepository;
  readonly reviewInsights: ReviewInsightRepository;
  readonly insightMemories: InsightMemoryRepository;
  readonly sourceRecords: SourceRecordRepository;
  readonly auditEvents: AuditEventRepository;
  readonly idempotencyRecords: IdempotencyRecordRepository;
  readonly archiveMarkers: ArchiveMarkerRepository;
  readonly jobs: JobRepository;
  readonly operatorSettings: OperatorSettingsRepository;
}
