export type UUID = string;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type WorkflowKind = 'COPYWRITER' | 'REVIEWER';
export type WorkflowStatus = string;
export type VersionStatus = 'DRAFT' | 'READY' | 'CONFIRMED' | 'ARCHIVED';

export interface RecordIdentity {
  readonly id: UUID;
  readonly createdAt: Date;
  readonly createdBy: UUID | 'SYSTEM';
}

export interface ImmutableVersionIdentity extends RecordIdentity {
  readonly version: number;
  readonly contentHash: string;
  readonly editedBy?: UUID;
  readonly editReason?: string;
}

export interface SessionVersionIdentity extends ImmutableVersionIdentity {
  readonly sessionId: UUID;
}

export type ContentBriefFieldName =
  | 'subject'
  | 'targetAudience'
  | 'coreOutcome'
  | 'painPoint'
  | 'method'
  | 'parameters'
  | 'realLimitation'
  | 'closingAction';

export interface ContentBriefFields {
  readonly subject: string;
  readonly targetAudience: string;
  readonly coreOutcome: string;
  readonly painPoint: string;
  readonly method: string;
  readonly parameters: string;
  readonly realLimitation: string;
  readonly closingAction: string;
}

export interface WorkflowSession extends RecordIdentity {
  readonly operatorId: UUID;
  readonly kind: WorkflowKind;
  readonly status: WorkflowStatus;
  readonly currentVersion: number;
  readonly updatedAt: Date;
  readonly archivedAt?: Date;
}

export interface ContentBriefVersion extends SessionVersionIdentity, ContentBriefFields {
  readonly status: VersionStatus;
  readonly blockedTermListIds: readonly UUID[];
  readonly sourceRecordIds: readonly UUID[];
  readonly supplementaryFileIds: readonly UUID[];
  readonly insightMemoryIds: readonly UUID[];
  readonly operatorProvidedFields: readonly ContentBriefFieldName[];
  readonly missingFields: readonly ContentBriefFieldName[];
}

export type QuestionSetStatus = 'OPEN' | 'ANSWERED' | 'DECLINED';
export type ThreeAnswers = readonly [string | null, string | null, string | null];
export type ThreeQuestions = readonly [string, string, string];
export type ThreeQuestionFieldBindings = readonly [ContentBriefFieldName, ContentBriefFieldName, ContentBriefFieldName];

export interface QuestionSet extends RecordIdentity {
  readonly sessionId: UUID;
  readonly briefVersion: number;
  readonly questions: ThreeQuestions;
  readonly fieldBindings: ThreeQuestionFieldBindings;
  readonly answers: ThreeAnswers;
  readonly version: number;
  readonly status: QuestionSetStatus;
  readonly answeredAt?: Date;
}

export type ValidationStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'NEEDS_OPERATOR_CONFIRMATION';
export type ComplianceStatus = 'NOT_CHECKED' | 'PASSED' | 'ISSUES_FOUND';
export type TagBuckets = {
  readonly broad: readonly [string, string, string];
  readonly medium: readonly [string, string, string];
  readonly longTail: readonly [string, string];
};

export interface ModelMetadata {
  readonly providerId: string;
  readonly modelId: string;
  readonly requestId?: string;
  readonly durationMs?: number;
}

export interface CopyDraftVersion extends SessionVersionIdentity {
  readonly targetAudience: string;
  readonly targetEmotion: string;
  readonly titles: readonly [string, string, string, string, string];
  readonly opening: string;
  readonly firstThreeLines: string;
  readonly painPoint: string;
  readonly method: string;
  readonly realLimitation: string;
  readonly body: string;
  readonly bodyPoints: readonly [string, string, string];
  readonly interactionEnding: string;
  readonly tags: readonly [string, string, string, string, string, string, string, string];
  readonly tagBuckets: TagBuckets;
  readonly appliedRuleIds: readonly UUID[];
  readonly validationStatus: ValidationStatus;
  readonly complianceStatus: ComplianceStatus;
  readonly needsOperatorConfirmation: boolean;
  readonly modelMetadata?: ModelMetadata;
  readonly sourceRecordIds: readonly UUID[];
}

export type FileParseStatus = 'PENDING' | 'READABLE' | 'UNREADABLE' | 'REPLACED' | 'ARCHIVED';
export type SupplementaryFileManualAction = 'CONTINUE_WITH_BRIEF' | 'REPLACE_FILE';

export interface SupplementaryFile extends RecordIdentity {
  readonly sessionId: UUID;
  readonly objectKey: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly version: number;
  readonly parseStatus: FileParseStatus;
  readonly parseErrorCode?: string;
  readonly sourceRecordId: UUID;
  readonly parseSourceRecordId?: UUID;
  /** Parsed text is a bounded, normalized business input; raw upload bytes remain in object storage. */
  readonly parsedContent?: string;
  readonly parsedContentHash?: string;
  readonly contentSourceRecordId?: UUID;
  readonly boundBriefVersion?: number;
  readonly manualAction?: SupplementaryFileManualAction;
  readonly manualActionSourceRecordId?: UUID;
  readonly archivedAt?: Date;
}

export type SettingsVersionStatus = 'ACTIVE' | 'ARCHIVED';

export interface BlockedTermListVersion extends ImmutableVersionIdentity {
  readonly operatorId: UUID;
  readonly name: string;
  readonly terms: readonly string[];
  readonly normalizationPolicy: JsonObject;
  readonly status: SettingsVersionStatus;
  readonly importedFrom?: string;
  readonly archivedAt?: Date;
}

export type ComplianceTargetType = 'COPY_DRAFT' | 'COVER_BRIEF' | 'COVER_ASSET' | 'REVIEW_INSIGHT';
export type ClaimStatus = 'VERIFIED' | 'NEEDS_OPERATOR_CONFIRMATION' | 'REMOVED';
export type ComplianceMatchStatus = 'MATCHED' | 'NOT_CONFIGURED' | 'NO_MATCH';

export interface ComplianceMatch {
  readonly id: UUID;
  readonly resultId: UUID;
  readonly term: string;
  readonly normalizedTerm: string;
  readonly block: string;
  readonly occurrenceCount: number;
  readonly sourceListId: UUID;
  readonly sourceListVersion: number;
  readonly span?: JsonObject;
}

export interface ComplianceClaim {
  readonly id: UUID;
  readonly resultId: UUID;
  readonly claim: string;
  readonly sourceRecordIds: readonly UUID[];
  readonly status: ClaimStatus;
}

export interface ComplianceResult extends RecordIdentity {
  readonly targetType: ComplianceTargetType;
  readonly targetVersionId: UUID;
  readonly status: ComplianceMatchStatus;
  readonly checkedBlocks: readonly string[];
  readonly blockedTermListIds: readonly UUID[];
  readonly matches: readonly ComplianceMatch[];
  readonly claims: readonly ComplianceClaim[];
}

export interface CoverBrief extends SessionVersionIdentity {
  readonly draftVersionId: UUID;
  readonly title: string;
  readonly visualStyle: string;
  readonly whitespaceRequirements: string;
  readonly limitationOrCaveat: string;
  readonly illustrationDescription: string;
  readonly sourceRecordIds: readonly UUID[];
}

export type CoverAssetStatus =
  | 'PENDING'
  | 'GENERATING'
  | 'READY'
  | 'FAILED'
  | 'REPLACEMENT'
  | 'ARCHIVED';
export type CoverAssetOrigin = 'GENERATED' | 'OPERATOR_UPLOAD' | 'OPERATOR_EDIT';

export interface CoverAsset extends RecordIdentity {
  readonly sessionId: UUID;
  readonly coverBriefVersionId: UUID;
  readonly objectKey?: string;
  readonly mimeType?: string;
  readonly width?: number;
  readonly height?: number;
  readonly aspectRatio?: string;
  readonly pixelHash?: string;
  readonly version: number;
  readonly status: CoverAssetStatus;
  readonly origin: CoverAssetOrigin;
  readonly generatedAt?: Date;
  readonly failureCode?: string;
  readonly failureMessage?: string;
  readonly editVersion: number;
  readonly sourceRecordIds: readonly UUID[];
  readonly archivedAt?: Date;
}

export type AccountMode = 'AUTHORIZED_ACCOUNT' | 'PUBLIC_ACCESS';

export interface AccessAuthorizationConfirmation extends RecordIdentity {
  readonly reviewId: UUID;
  readonly exactNoteUrl: string;
  readonly normalizedNoteUrl: string;
  readonly toolId: string;
  readonly purpose: string;
  readonly accountMode: AccountMode;
  readonly confirmedAt: Date;
  readonly operatorId: UUID;
  readonly expiresAt?: Date;
  readonly confirmationVersion: number;
  readonly version: number;
  readonly invalidatedAt?: Date;
}

export interface AccessibleContent extends RecordIdentity {
  readonly reviewId: UUID;
  readonly authorizationId: UUID;
  readonly retrievedAt: Date;
  readonly contentType: string;
  readonly title?: string;
  readonly body?: string;
  readonly coverReference?: string;
  readonly observedMetrics: JsonObject;
  readonly rawHash: string;
  readonly platformLimitations: readonly string[];
  readonly sourceRecordId: UUID;
}

export interface ManualContentInput extends SessionVersionIdentity {
  readonly reviewId: UUID;
  readonly title?: string;
  readonly body?: string;
  readonly coverDescription?: string;
  readonly metricValues: JsonObject;
  readonly sourceRecordId: UUID;
}

export type MetricType =
  | 'EXPOSURE'
  | 'CTR'
  | 'READ_SECONDS'
  | 'COMPLETION_RATE'
  | 'LIKE_RATE'
  | 'SAVE_RATE'
  | 'COMMENT_RATE'
  | 'FOLLOWERS';

export type MetricUnit = 'COUNT' | 'BASIS_POINTS' | 'SECONDS';
export type MetricOrigin = 'OPENCLI' | 'MANUAL' | 'OBSERVED_CONTENT';
export type ThresholdComparator = 'GT' | 'GTE' | 'LT' | 'LTE' | 'EQ' | 'RANGE';
export type BoundaryAction = 'CLASSIFY' | 'OPERATOR_CONFIRMATION' | 'UNDEFINED';

export interface MetricThresholdRule {
  readonly id: UUID;
  readonly thresholdSetId: UUID;
  readonly metricType: MetricType;
  readonly label: string;
  readonly comparator: ThresholdComparator;
  readonly lowerValue?: number;
  readonly upperValue?: number;
  readonly unit: MetricUnit;
  readonly boundaryAction: BoundaryAction;
  readonly outcome: string;
  readonly metadata: JsonObject;
}

export interface MetricThresholdSet extends ImmutableVersionIdentity {
  readonly operatorId: UUID;
  readonly completionRatePolicy: 'UNDEFINED_UNLESS_OPERATOR_DEFINED' | 'OPERATOR_DEFINED';
  readonly status: SettingsVersionStatus;
  readonly rules: readonly MetricThresholdRule[];
  readonly archivedAt?: Date;
}

export interface MetricValue extends ImmutableVersionIdentity {
  readonly reviewId: UUID;
  readonly metricType: MetricType;
  readonly value: number;
  readonly unit: MetricUnit;
  readonly origin: MetricOrigin;
  readonly sourceRecordId: UUID;
  readonly enteredAt: Date;
}

export type ColorConclusion = 'GREEN' | 'YELLOW' | null;

export interface MetricAssessment {
  readonly metricType: MetricType;
  readonly value?: number;
  readonly unit?: MetricUnit;
  readonly sourceRecordId?: UUID;
  readonly metricVersion?: number;
  readonly thresholdSetVersion?: number;
  readonly classification: string;
  readonly outcome?: string;
  readonly boundary: boolean;
  readonly triggerRuleId?: UUID;
}

export interface ReviewRecommendation {
  readonly metricType: MetricType;
  readonly value?: number;
  readonly triggerRule: string;
  readonly contentAnchors: readonly string[];
  readonly action: string;
  readonly sourceRecordIds: readonly UUID[];
}

export interface ReviewResultVersion extends SessionVersionIdentity {
  readonly reviewId: UUID;
  readonly contentSummary: string;
  readonly metricAssessments: readonly MetricAssessment[];
  readonly coreExcellentCount: number;
  readonly colorConclusion: ColorConclusion;
  readonly observableConclusions: readonly string[];
  readonly needsHumanConfirmation: readonly string[];
  readonly notEvaluable: readonly string[];
  readonly reasons: readonly string[];
  readonly recommendations: readonly ReviewRecommendation[];
  readonly markdownTemplate: string;
  readonly sourceRecordIds: readonly UUID[];
}

export type InsightStatus = 'CANDIDATE' | 'APPROVED' | 'BLOCKED' | 'ARCHIVED';

export interface ReviewInsight extends SessionVersionIdentity {
  readonly reviewId: UUID;
  readonly selectedText: string;
  readonly insightType: string;
  readonly normalizedInsight: string;
  readonly metricThresholdSetVersion: number;
  readonly complianceResultId?: UUID;
  readonly status: InsightStatus;
  readonly sourceRecordIds: readonly UUID[];
}

export interface InsightMemory extends RecordIdentity {
  readonly insightId: UUID;
  readonly text: string;
  readonly sourceNoteUrlOrManualInput: string;
  readonly savedAt: Date;
  readonly metricThresholdSetVersion: number;
  readonly complianceResultId: UUID;
  readonly sourceRecordIds: readonly UUID[];
  readonly status: 'APPROVED' | 'ARCHIVED';
  readonly version: number;
  readonly archivedAt?: Date;
}

export type SourceRecordType =
  | 'SOURCE_RULES'
  | 'BRIEF_FIELD'
  | 'FILE'
  | 'URL'
  | 'AUTHORIZATION'
  | 'OPENCLI_CONTENT'
  | 'MANUAL_INPUT'
  | 'METRIC'
  | 'THRESHOLD_SET'
  | 'INSIGHT'
  | 'MODEL_OUTPUT'
  | 'HUMAN_EDIT';
export type RedactionStatus = 'NOT_REQUIRED' | 'REDACTED' | 'REVIEW_REQUIRED';

export interface SourceRecord extends RecordIdentity {
  readonly sourceType: SourceRecordType;
  readonly sourceRef: string;
  readonly version: number;
  readonly contentHash?: string;
  readonly capturedAt: Date;
  readonly operatorId?: UUID;
  readonly parentSourceRecordIds: readonly UUID[];
  readonly accessLimitations: readonly string[];
  readonly redactionStatus: RedactionStatus;
}

export type AuditActorType = 'OPERATOR' | 'SYSTEM' | 'MODEL' | 'OPENCLI';

export interface AuditEvent extends RecordIdentity {
  readonly actorType: AuditActorType;
  readonly actorId?: UUID;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: UUID;
  readonly beforeHash?: string;
  readonly afterHash?: string;
  readonly reason?: string;
  readonly resultStatus: string;
  readonly sourceRecordId?: UUID;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly toolId?: string;
  readonly traceId: string;
}

export type JobKind =
  | 'COPY_GENERATION'
  | 'FILE_PARSE'
  | 'COVER_GENERATION'
  | 'OPENCLI_FETCH'
  | 'REVIEW_EVALUATION';
export type JobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'RETRYABLE_FAILURE'
  | 'TERMINAL_FAILURE';
export type JobPhase =
  | 'QUEUED'
  | 'RUNNING'
  | 'RETRYING'
  | 'SUCCEEDED'
  | 'MANUAL_FALLBACK';

export interface JobSourceSummary {
  readonly sourceRecordId?: UUID;
  readonly sourceType?: SourceRecordType;
  readonly version?: number;
  readonly capturedAt?: Date;
  readonly accessLimitations: readonly string[];
  readonly redacted: true;
}

export interface JobFallback {
  readonly required: boolean;
  readonly action: string;
  readonly errorCode?: string;
}

export interface Job extends RecordIdentity {
  readonly operatorId: UUID;
  readonly kind: JobKind;
  readonly status: JobStatus;
  readonly phase: JobPhase;
  readonly entityId: UUID;
  readonly inputVersion: number;
  readonly idempotencyKey: string;
  readonly version: number;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly errorCode?: string;
  readonly sourceRecordId?: UUID;
  readonly sourceSummary: JobSourceSummary;
  readonly fallback: JobFallback;
  readonly startedAt?: Date;
  readonly finishedAt?: Date;
  readonly updatedAt: Date;
}

export interface OperatorSettings extends RecordIdentity {
  readonly operatorId: UUID;
  readonly currentBlockedTermListId?: UUID;
  readonly currentThresholdSetId?: UUID;
  readonly version: number;
  readonly updatedAt: Date;
}

export interface SourceRecordLink {
  readonly sourceRecordId: UUID;
  readonly entityType: string;
  readonly entityId: UUID;
  readonly role: string;
}

export interface ArchiveMarker {
  readonly entityType: string;
  readonly entityId: UUID;
  readonly archivedAt: Date;
  readonly archivedBy?: UUID;
}

export type IdempotencyStatus = 'IN_PROGRESS' | 'COMPLETED';

export interface IdempotencyRecord extends RecordIdentity {
  readonly idempotencyKey: string;
  readonly jobId: UUID;
  readonly inputVersion: number;
  readonly step: string;
  readonly entityId: UUID;
  readonly status: IdempotencyStatus;
  readonly resultEntityId?: UUID;
  readonly resultVersion?: number;
  readonly completedAt?: Date;
  readonly version: number;
}
