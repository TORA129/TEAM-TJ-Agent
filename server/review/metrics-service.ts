import { createHash } from 'node:crypto';
import type { MetricThresholdRule, MetricThresholdSet, MetricValue, UUID } from '@/domain/persistence/models';
import type { PersistenceRepositories } from '@/domain/persistence/repositories';
import { createDefaultMetricThresholdSet, evaluateMetric, validateMetricValue } from '@/domain/metrics';
import { evaluateReviewMetrics } from '@/domain/review-metrics-evaluation';
import { AuditEventService, ImmutableVersionService, PersistenceVersionConflictError, SourceRecordService } from '@/domain/persistence/services';
import { PublicApplicationError } from '@/server/public-errors';
import type { MetricPatchRequest, ThresholdPatchRequest } from './schema';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const notFound = () => new PublicApplicationError({ code: 'JOB_NOT_FOUND' });
const conflict = (currentVersion: number) => new PublicApplicationError({ code: 'VERSION_CONFLICT', currentVersion });

export class ReviewMetricsService {
  private readonly sources: SourceRecordService;
  private readonly audits: AuditEventService;
  constructor(private readonly repositories: PersistenceRepositories, private readonly now = () => new Date()) {
    this.sources = new SourceRecordService(repositories.sourceRecords);
    this.audits = new AuditEventService(repositories.auditEvents, repositories.sourceRecords);
  }

  async getMetrics(input: { reviewId: UUID; operatorId: UUID }) {
    await this.owned(input.reviewId, input.operatorId);
    const page = await this.repositories.metricValues.listByReview(input.reviewId, { limit: 1_000 });
    return { reviewId: input.reviewId, metrics: page.items.map((item) => this.metricDto(item)) };
  }

  async patchMetrics(input: { reviewId: UUID; operatorId: UUID; request: MetricPatchRequest; expectedVersion: number; idempotencyKey: string; traceId: string }) {
    await this.owned(input.reviewId, input.operatorId);
    const key = `review-metrics:${input.operatorId}:${input.idempotencyKey}`;
    const existing = await this.repositories.idempotencyRecords.getByKey(key);
    if (existing?.status === 'COMPLETED' && existing.resultEntityId) return { metrics: await this.getMetrics({ reviewId: input.reviewId, operatorId: input.operatorId }), created: false };
    if (existing) throw new PublicApplicationError({ code: 'REQUEST_INVALID', fieldErrors: { idempotencyKey: ['This key is already associated with different inputs.'] } });
    const claim = await this.repositories.idempotencyRecords.create({ idempotencyKey: key, jobId: input.operatorId, inputVersion: input.expectedVersion, step: `metrics:${hash(input.request)}`, entityId: input.reviewId, status: 'IN_PROGRESS', version: 1 });
    const current = await this.getMetrics({ reviewId: input.reviewId, operatorId: input.operatorId });
    const latestVersion = Math.max(0, ...current.metrics.map((item) => item.version));
    if (latestVersion !== input.expectedVersion) throw conflict(latestVersion);
    let last: MetricValue | undefined;
    try {
      for (const item of input.request.metrics) {
        if (item.value === null) continue;
        const source = await this.sources.create({ sourceType: 'MANUAL_INPUT', sourceRef: `manual-metric:${input.reviewId}:${item.metricType}:v${input.expectedVersion + 1}`, version: input.expectedVersion + 1, contentHash: hash(item), capturedAt: this.now(), operatorId: input.operatorId, parentSourceRecordIds: [], accessLimitations: ['指标由 Operator 人工提供，缺失值不会被推断'], redactionStatus: 'NOT_REQUIRED' });
        validateMetricValue({ metricType: item.metricType, value: item.value, unit: item.unit, origin: 'MANUAL', sourceRecordId: source.id });
        last = await this.repositories.metricValues.append({ reviewId: input.reviewId, metricType: item.metricType, value: item.value, unit: item.unit, origin: 'MANUAL', sourceRecordId: source.id, enteredAt: this.now(), version: input.expectedVersion + 1, contentHash: hash(item), editedBy: input.operatorId, editReason: input.request.editReason });
        await this.sources.link({ sourceRecordId: source.id, entityType: 'METRIC_VALUE', entityId: last.id, role: 'OPERATOR_MANUAL' });
        await this.audits.append({ actorType: 'OPERATOR', actorId: input.operatorId, action: 'METRICS', entityType: 'METRIC_VALUE', entityId: last.id, afterHash: last.contentHash, reason: input.request.editReason, resultStatus: 'CREATED', sourceRecordId: source.id, traceId: input.traceId });
      }
      if (!last) throw new PublicApplicationError({ code: 'VALIDATION_FAILED', fieldErrors: { metrics: ['At least one metric value is required.'] } });
      const completed = await this.repositories.idempotencyRecords.complete(claim.id, { expectedVersion: 1, resultEntityId: last.id, resultVersion: last.version, completedAt: this.now() });
      if ('actualVersion' in completed) throw conflict(completed.actualVersion);
      return { metrics: await this.getMetrics({ reviewId: input.reviewId, operatorId: input.operatorId }), created: true };
    } catch (error) {
      if (error instanceof PersistenceVersionConflictError) throw conflict(error.actualVersion);
      throw error;
    }
  }

  async evaluate(input: { reviewId: UUID; operatorId: UUID; expectedVersion: number; traceId: string; completionRateMarkedLow?: boolean }) {
    await this.owned(input.reviewId, input.operatorId);
    const thresholdPage = await this.repositories.metricThresholdSets.listByOperator(input.operatorId, { limit: 1_000 });
    const thresholdSet = thresholdPage.items.at(-1) ?? createDefaultMetricThresholdSet(input.operatorId, this.now());
    const metrics = (await this.repositories.metricValues.listByReview(input.reviewId, { limit: 1_000 })).items;
    const evaluation = evaluateReviewMetrics({ metricValues: metrics, thresholdSet, completionRateMarkedLow: input.completionRateMarkedLow });
    const source = await this.sources.create({ sourceType: 'METRIC', sourceRef: `review-evaluation:${input.reviewId}:v${input.expectedVersion + 1}`, version: input.expectedVersion + 1, contentHash: hash({ metricIds: metrics.map((item) => item.id), thresholdSetId: thresholdSet.id, thresholdSetVersion: thresholdSet.version, evaluation }), capturedAt: this.now(), operatorId: input.operatorId, parentSourceRecordIds: evaluation.sourceRecordIds, accessLimitations: ['指标评估只使用已保存值，不推断缺失指标；完播率默认供人工复盘'], redactionStatus: 'NOT_REQUIRED' });
    const saved = await new ImmutableVersionService().append({ repository: this.repositories.reviewResultVersions, sessionId: input.reviewId, expectedVersion: input.expectedVersion, input: { reviewId: input.reviewId, contentSummary: '基于当前已保存指标的确定性分层结果', metricAssessments: evaluation.metricAssessments, coreExcellentCount: evaluation.coreExcellentCount, colorConclusion: evaluation.colorConclusion, observableConclusions: evaluation.observableConclusions, needsHumanConfirmation: evaluation.needsHumanConfirmation, notEvaluable: evaluation.notEvaluable, reasons: [], recommendations: [], markdownTemplate: '', sourceRecordIds: [source.id], contentHash: hash(evaluation) } });
    await this.sources.link({ sourceRecordId: source.id, entityType: 'REVIEW_RESULT_VERSION', entityId: saved.id, role: 'EVALUATION_INPUT_AND_RESULT' });
    await this.audits.append({ actorType: 'OPERATOR', actorId: input.operatorId, action: 'EVALUATE_METRICS', entityType: 'REVIEW_RESULT_VERSION', entityId: saved.id, afterHash: saved.contentHash, resultStatus: evaluation.colorConclusion ?? 'NEEDS_HUMAN_INPUT', sourceRecordId: source.id, traceId: input.traceId });
    return { result: { ...saved, createdAt: saved.createdAt.toISOString(), thresholdSetId: evaluation.thresholdSetId, thresholdSetVersion: evaluation.thresholdSetVersion }, created: true };
  }  async getThresholds(input: { operatorId: UUID }) {
    const page = await this.repositories.metricThresholdSets.listByOperator(input.operatorId, { limit: 1_000 });
    const current = page.items.at(-1) ?? createDefaultMetricThresholdSet(input.operatorId, this.now());
    return this.thresholdDto(current);
  }

  async patchThresholds(input: { operatorId: UUID; request: ThresholdPatchRequest; expectedVersion: number; idempotencyKey: string; traceId: string }) {
    const current = (await this.repositories.metricThresholdSets.listByOperator(input.operatorId, { limit: 1_000 })).items.at(-1);
    const actual = current?.version ?? 0;
    if (actual !== input.expectedVersion) throw conflict(actual);
    const key = `review-thresholds:${input.operatorId}:${input.idempotencyKey}`;
    const existing = await this.repositories.idempotencyRecords.getByKey(key);
    if (existing?.status === 'COMPLETED' && existing.resultEntityId) { const saved = await this.repositories.metricThresholdSets.getById(existing.resultEntityId); if (saved) return { thresholds: this.thresholdDto(saved), created: false }; }
    if (existing) throw new PublicApplicationError({ code: 'REQUEST_INVALID', fieldErrors: { idempotencyKey: ['This key is already associated with different inputs.'] } });
    const claim = await this.repositories.idempotencyRecords.create({ idempotencyKey: key, jobId: input.operatorId, inputVersion: input.expectedVersion, step: `thresholds:${hash(input.request)}`, entityId: input.operatorId, status: 'IN_PROGRESS', version: 1 });
    const id = `metric-thresholds:${input.operatorId}:v${actual + 1}`;
    const rules = input.request.rules.map((rule) => ({ ...rule, thresholdSetId: id }));
    const saved = await this.repositories.metricThresholdSets.create({ operatorId: input.operatorId, version: actual + 1, contentHash: hash({ ...input.request, rules }), completionRatePolicy: input.request.completionRatePolicy, status: 'ACTIVE', rules, ...(input.request.editReason ? { editedBy: input.operatorId, editReason: input.request.editReason } : {}) });
    if (current) await this.repositories.metricThresholdSets.archive(current.id);
    await this.repositories.idempotencyRecords.complete(claim.id, { expectedVersion: 1, resultEntityId: saved.id, resultVersion: saved.version, completedAt: this.now() });
    await this.audits.append({ actorType: 'OPERATOR', actorId: input.operatorId, action: 'METRICS', entityType: 'METRIC_THRESHOLD_SET', entityId: saved.id, afterHash: saved.contentHash, reason: input.request.editReason, resultStatus: 'CREATED', traceId: input.traceId });
    return { thresholds: this.thresholdDto(saved), created: true };
  }

  private async owned(reviewId: UUID, operatorId: UUID) { const review = await this.repositories.workflowSessions.getById(reviewId); if (!review || review.operatorId !== operatorId || review.kind !== 'REVIEWER') throw notFound(); return review; }
  private metricDto(item: MetricValue) { return { id: item.id, metricType: item.metricType, value: item.value, unit: item.unit, origin: item.origin, sourceRecordId: item.sourceRecordId, enteredAt: item.enteredAt.toISOString(), version: item.version, contentHash: item.contentHash, ...(item.editReason ? { editReason: item.editReason } : {}) }; }
  private thresholdDto(item: MetricThresholdSet) { return { id: item.id, operatorId: item.operatorId, version: item.version, completionRatePolicy: item.completionRatePolicy, status: item.status, rules: item.rules, createdAt: item.createdAt.toISOString(), ...(item.editReason ? { editReason: item.editReason } : {}) }; }
}
