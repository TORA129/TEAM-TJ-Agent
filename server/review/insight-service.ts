import { createHash, randomUUID } from 'node:crypto';

import type {
  ComplianceClaim,
  ComplianceMatch,
  ComplianceResult,
  InsightMemory,
  ReviewInsight,
  SourceRecord,
  UUID,
} from '@/domain/persistence/models';
import type { PersistenceRepositories } from '@/domain/persistence/repositories';
import {
  AuditEventService,
  ImmutableVersionService,
  PersistenceVersionConflictError,
  SourceRecordService,
} from '@/domain/persistence/services';
import { PublicApplicationError } from '@/server/public-errors';
import type { InsightCheckRequest, InsightSaveRequest } from './schema';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalize = (value: string) => value.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').toLowerCase();
const allowedSourceTypes = new Set(['URL', 'OPENCLI_CONTENT', 'MANUAL_INPUT', 'METRIC', 'THRESHOLD_SET', 'INSIGHT', 'AUTHORIZATION']);

function notFound(): PublicApplicationError { return new PublicApplicationError({ code: 'JOB_NOT_FOUND' }); }
function complianceBlocked(fieldErrors: Record<string, readonly string[]>): PublicApplicationError { return new PublicApplicationError({ code: 'COMPLIANCE_BLOCKED', fieldErrors }); }
function conflict(error: PersistenceVersionConflictError): PublicApplicationError { return new PublicApplicationError({ code: 'VERSION_CONFLICT', currentVersion: error.actualVersion }); }

export type InsightComplianceDto = Readonly<{
  status: ComplianceResult['status'];
  checkedBlocks: readonly string[];
  blockedTermListIds: readonly UUID[];
  matches: readonly ComplianceMatch[];
  claims: readonly ComplianceClaim[];
  missingSourceRecordIds: readonly UUID[];
  complianceResultId?: UUID;
}>;
export type InsightMemoryDto = Readonly<{
  readonly id: UUID;
  readonly insightId: UUID;
  readonly text: string;
  readonly sourceNoteUrlOrManualInput: string;
  readonly savedAt: string;
  readonly metricThresholdSetVersion: number;
  readonly complianceResultId: UUID;
  readonly sourceRecordIds: readonly UUID[];
  readonly status: InsightMemory['status'];
  readonly version: number;
  readonly archivedAt?: string;
}>;

export type CopywriterInsightReferenceDto = Readonly<{
  readonly id: UUID;
  readonly insightId: UUID;
  readonly text: string;
  readonly source: string;
  readonly savedAt: string;
  readonly metricThresholdSetVersion: number;
  readonly complianceResultId: UUID;
  readonly sourceRecordIds: readonly UUID[];
  readonly status: 'APPROVED' | 'ARCHIVED';
  readonly role: 'SUPPLEMENTARY_CONTEXT';
  readonly cannotReplaceBriefFacts: true;
}>;

export class ReviewInsightService {
  private readonly versions = new ImmutableVersionService();
  private readonly sources: SourceRecordService;
  private readonly audits: AuditEventService;
  private readonly now: () => Date;

  constructor(private readonly repositories: PersistenceRepositories, options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
    this.sources = new SourceRecordService(repositories.sourceRecords);
    this.audits = new AuditEventService(repositories.auditEvents, repositories.sourceRecords);
  }

  async list(input: { operatorId: UUID; page?: { readonly limit: number; readonly cursor?: string } }): Promise<{ items: readonly InsightMemoryDto[] }> {
    const page = await this.repositories.insightMemories.listByOperator(input.operatorId, input.page ?? { limit: 50 });
    return { items: page.items.map((memory) => this.memoryDto(memory)).filter((memory) => memory.status === 'APPROVED') };
  }

  async archive(input: { operatorId: UUID; memoryId: UUID; expectedVersion: number; traceId: string }): Promise<{ memory: InsightMemoryDto }> {
    const owned = (await this.repositories.insightMemories.listByOperator(input.operatorId, { limit: 1_000 })).items.find((memory) => memory.id === input.memoryId);
    if (!owned) throw notFound();
    const current = await this.repositories.insightMemories.getById(input.memoryId);
    if (!current) throw notFound();
    const result = await this.repositories.insightMemories.archive(input.memoryId, { expectedVersion: input.expectedVersion });
    if ('actualVersion' in result) throw new PublicApplicationError({ code: 'VERSION_CONFLICT', currentVersion: result.actualVersion });
    const sourceRecordId = result.sourceRecordIds[0];
    await this.audits.append({ actorType: 'OPERATOR', actorId: input.operatorId, action: 'ARCHIVE', entityType: 'INSIGHT_MEMORY', entityId: result.id, beforeHash: hash(current), afterHash: hash(result), resultStatus: 'ARCHIVED', sourceRecordId, traceId: input.traceId });
    return { memory: this.memoryDto(result) };
  }

  async references(input: { operatorId: UUID; memoryIds: readonly UUID[] }): Promise<{ items: readonly CopywriterInsightReferenceDto[] }> {
    const memories = await Promise.all(input.memoryIds.map((id) => this.repositories.insightMemories.getById(id)));
    const ownedIds = new Set((await this.repositories.insightMemories.listByOperator(input.operatorId, { limit: 1_000 })).items.map((memory) => memory.id));
    const unauthorized = memories.some((memory) => !memory || !ownedIds.has(memory.id) || memory.status !== 'APPROVED');
    if (unauthorized) throw notFound();
    return { items: memories.filter((memory): memory is InsightMemory => Boolean(memory)).map((memory) => ({ ...this.memoryDto(memory), source: memory.sourceNoteUrlOrManualInput, role: 'SUPPLEMENTARY_CONTEXT' as const, cannotReplaceBriefFacts: true as const })) };
  }

  private memoryDto(memory: InsightMemory): InsightMemoryDto {
    return { id: memory.id, insightId: memory.insightId, text: memory.text, sourceNoteUrlOrManualInput: memory.sourceNoteUrlOrManualInput, savedAt: memory.savedAt.toISOString(), metricThresholdSetVersion: memory.metricThresholdSetVersion, complianceResultId: memory.complianceResultId, sourceRecordIds: [...memory.sourceRecordIds], status: memory.status, version: memory.version, ...(memory.archivedAt ? { archivedAt: memory.archivedAt.toISOString() } : {}) };
  }
  async check(input: { reviewId: UUID; operatorId: UUID; request: InsightCheckRequest }): Promise<InsightComplianceDto> {
    await this.ownedReview(input.reviewId, input.operatorId);
    const sourceState = await this.resolveSources(input.operatorId, input.request.sourceRecordIds);
    const evaluation = await this.evaluate(input.operatorId, input.request.selectedText, sourceState.records, sourceState.missingIds);
    this.assertPass(evaluation);
    return evaluation;
  }

  async save(input: { reviewId: UUID; operatorId: UUID; request: InsightSaveRequest; traceId: string }): Promise<{ insight: ReviewInsight; memory: InsightMemory; compliance: ComplianceResult }> {
    await this.ownedReview(input.reviewId, input.operatorId);
    const sourceState = await this.resolveSources(input.operatorId, input.request.sourceRecordIds);
    const evaluation = await this.evaluate(input.operatorId, input.request.selectedText, sourceState.records, sourceState.missingIds);
    this.assertPass(evaluation);
    const now = this.now();
    let insight: ReviewInsight;
    try {
      insight = await this.versions.append({
        repository: this.repositories.reviewInsights,
        sessionId: input.reviewId,
        expectedVersion: input.request.expectedInsightVersion ?? 0,
        input: {
          reviewId: input.reviewId,
          selectedText: input.request.selectedText,
          insightType: input.request.insightType,
          normalizedInsight: normalize(input.request.selectedText),
          metricThresholdSetVersion: input.request.metricThresholdSetVersion,
          status: 'APPROVED',
          sourceRecordIds: input.request.sourceRecordIds,
          contentHash: hash(input.request),
          editedBy: input.operatorId,
          ...(input.request.editReason ? { editReason: input.request.editReason } : {}),
        },
      });
    } catch (error) {
      if (error instanceof PersistenceVersionConflictError) throw conflict(error);
      throw error;
    }
    const complianceId = randomUUID();
    const compliance = await this.repositories.complianceResults.create({
      id: complianceId,
      targetType: 'REVIEW_INSIGHT',
      targetVersionId: insight.id,
      status: evaluation.status,
      checkedBlocks: evaluation.checkedBlocks,
      blockedTermListIds: evaluation.blockedTermListIds,
      matches: evaluation.matches.map((match) => ({ ...match, resultId: complianceId })),
      claims: evaluation.claims.map((claim) => ({ ...claim, resultId: complianceId })),
    });
    const memory = await this.repositories.insightMemories.create({
      insightId: insight.id,
      text: insight.selectedText,
      sourceNoteUrlOrManualInput: input.request.sourceNoteUrlOrManualInput,
      savedAt: now,
      metricThresholdSetVersion: insight.metricThresholdSetVersion,
      complianceResultId: compliance.id,
      sourceRecordIds: input.request.sourceRecordIds,
      status: 'APPROVED',
      version: 1,
    });
    await this.sources.linkMany({ sourceRecordIds: input.request.sourceRecordIds, entityType: 'REVIEW_INSIGHT', entityId: insight.id, role: 'INSIGHT_SOURCE' });
    await this.sources.linkMany({ sourceRecordIds: input.request.sourceRecordIds, entityType: 'INSIGHT_MEMORY', entityId: memory.id, role: 'MEMORY_SOURCE' });
    await this.audits.append({ actorType: 'OPERATOR', actorId: input.operatorId, action: 'CONFIRMATION', entityType: 'INSIGHT_MEMORY', entityId: memory.id, afterHash: hash(memory), resultStatus: 'CREATED', sourceRecordId: input.request.sourceRecordIds[0], reason: 'Operator approved a review insight for Insight_Memory.', traceId: input.traceId });
    return { insight, memory, compliance };
  }

  private assertPass(evaluation: InsightComplianceDto): void {
    if (evaluation.missingSourceRecordIds.length || evaluation.status === 'MATCHED') {
      throw complianceBlocked({
        ...(evaluation.matches.length ? { blockedTerms: evaluation.matches.map((match) => `${match.term} (${match.block})`) } : {}),
        ...(evaluation.missingSourceRecordIds.length ? { sourceRecordIds: evaluation.missingSourceRecordIds } : {}),
      });
    }
  }

  private async ownedReview(reviewId: UUID, operatorId: UUID): Promise<void> {
    const review = await this.repositories.workflowSessions.getById(reviewId);
    if (!review || review.operatorId !== operatorId || review.kind !== 'REVIEWER') throw notFound();
  }

  private async resolveSources(operatorId: UUID, ids: readonly UUID[]): Promise<{ records: readonly SourceRecord[]; missingIds: readonly UUID[] }> {
    const loaded = await Promise.all(ids.map((id) => this.repositories.sourceRecords.getById(id)));
    const missingIds = ids.filter((id, index) => !loaded[index]);
    const records = loaded.filter((record): record is SourceRecord => Boolean(record));
    const invalid = records.filter((record) => (record.operatorId && record.operatorId !== operatorId) || !allowedSourceTypes.has(record.sourceType));
    return { records: records.filter((record) => !invalid.includes(record)), missingIds: [...missingIds, ...invalid.map((record) => record.id)] };
  }

  private async evaluate(operatorId: UUID, text: string, records: readonly SourceRecord[], missingIds: readonly UUID[]): Promise<InsightComplianceDto> {
    const lists = (await this.repositories.blockedTermLists.listByOperator(operatorId, { limit: 1_000 })).items.filter((list) => list.status === 'ACTIVE');
    const normalizedText = normalize(text);
    const matches: ComplianceMatch[] = [];
    for (const list of lists) for (const term of new Set(list.terms)) {
      const normalizedTerm = normalize(term);
      if (!normalizedTerm) continue;
      let offset = normalizedText.indexOf(normalizedTerm);
      let count = 0;
      const ranges: { start: number; end: number }[] = [];
      while (offset >= 0) { count += 1; ranges.push({ start: offset, end: offset + normalizedTerm.length }); offset = normalizedText.indexOf(normalizedTerm, offset + normalizedTerm.length); }
      if (count) matches.push({ id: randomUUID(), resultId: '', term, normalizedTerm, block: 'selectedText', occurrenceCount: count, sourceListId: list.id, sourceListVersion: list.version, span: { ranges } });
    }
    const claims: ComplianceClaim[] = [{ id: randomUUID(), resultId: '', claim: text, sourceRecordIds: records.map((record) => record.id), status: records.length ? 'VERIFIED' : 'NEEDS_OPERATOR_CONFIRMATION' }];
    return { status: lists.length === 0 ? 'NOT_CONFIGURED' : matches.length ? 'MATCHED' : 'NO_MATCH', checkedBlocks: ['selectedText'], blockedTermListIds: lists.map((list) => list.id), matches, claims, missingSourceRecordIds: missingIds };
  }
}
