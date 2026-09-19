import type {
  MetricAssessment,
  MetricThresholdSet,
  MetricType,
  MetricUnit,
  MetricValue,
  ReviewResultVersion,
  UUID,
} from './persistence/models';
import { evaluateMetric, type MetricEvaluation } from './metrics';

export const REVIEW_METRIC_TYPES: readonly MetricType[] = [
  'EXPOSURE',
  'CTR',
  'READ_SECONDS',
  'COMPLETION_RATE',
  'LIKE_RATE',
  'SAVE_RATE',
  'COMMENT_RATE',
  'FOLLOWERS',
];

export const CORE_METRIC_TYPES: readonly MetricType[] = [
  'EXPOSURE',
  'CTR',
  'READ_SECONDS',
  'LIKE_RATE',
  'SAVE_RATE',
  'COMMENT_RATE',
  'FOLLOWERS',
];

export interface ReviewMetricEvaluation {
  readonly metricAssessments: readonly MetricAssessment[];
  readonly coreExcellentCount: number;
  readonly colorConclusion: ReviewResultVersion['colorConclusion'];
  readonly observableConclusions: readonly string[];
  readonly needsHumanConfirmation: readonly string[];
  readonly notEvaluable: readonly string[];
  readonly sourceRecordIds: readonly UUID[];
  readonly thresholdSetId: UUID;
  readonly thresholdSetVersion: number;
}

export interface ReviewMetricEvaluationInput {
  readonly metricValues: readonly MetricValue[];
  readonly thresholdSet: MetricThresholdSet;
  readonly completionRateMarkedLow?: boolean;
}

function assessment(metric: MetricValue, evaluation: MetricEvaluation, thresholdVersion: number): MetricAssessment {
  return {
    metricType: metric.metricType,
    value: evaluation.value,
    unit: evaluation.unit,
    sourceRecordId: metric.sourceRecordId,
    classification: evaluation.classification,
    boundary: evaluation.boundary,
    triggerRuleId: evaluation.ruleId,
    metricVersion: metric.version,
    thresholdSetVersion: thresholdVersion,
    outcome: evaluation.outcome,
  };
}

export function evaluateReviewMetrics(input: ReviewMetricEvaluationInput): ReviewMetricEvaluation {
  const byType = new Map<MetricType, MetricValue>();
  for (const metric of input.metricValues) {
    const current = byType.get(metric.metricType);
    if (!current || metric.version > current.version) byType.set(metric.metricType, metric);
  }
  const assessments: MetricAssessment[] = [];
  const observable: string[] = [];
  const confirmation: string[] = [];
  const notEvaluable: string[] = [];
  const sourceIds = new Set<UUID>();

  for (const metricType of REVIEW_METRIC_TYPES) {
    const metric = byType.get(metricType);
    if (!metric) {
      assessments.push({ metricType, classification: 'MISSING', boundary: false, thresholdSetVersion: input.thresholdSet.version });
      notEvaluable.push(`${metricType}: 需要人工输入`);
      continue;
    }
    sourceIds.add(metric.sourceRecordId);
    const evaluation = evaluateMetric({ metricType, value: metric.value, unit: metric.unit, origin: metric.origin, sourceRecordId: metric.sourceRecordId }, input.thresholdSet);
    const item = assessment(metric, evaluation, input.thresholdSet.version);
    assessments.push(item);
    if (evaluation.boundary) confirmation.push(`${metricType}: ${evaluation.outcome}`);
    else if (evaluation.classification === 'MISSING') notEvaluable.push(`${metricType}: ${evaluation.outcome}`);
    else observable.push(`${metricType}: ${evaluation.outcome}`);
  }

  const core = assessments.filter((item) => CORE_METRIC_TYPES.includes(item.metricType));
  const coreWithValues = core.filter((item) => item.value !== undefined);
  const coreExcellentCount = core.filter((item) => item.value !== undefined && item.classification === 'EXCELLENT').length;
  const colorConclusion = coreWithValues.length === 0 ? null : coreExcellentCount >= 4 ? 'GREEN' : 'YELLOW';
  const completion = assessments.find((item) => item.metricType === 'COMPLETION_RATE');
  if (completion?.value !== undefined && completion.classification === 'MANUAL_REVIEW') {
    observable.push(`COMPLETION_RATE: ${input.completionRateMarkedLow ? '供人工复盘（Operator 标记低表现）' : '供人工复盘'}`);
  }
  return {
    metricAssessments: assessments,
    coreExcellentCount,
    colorConclusion,
    observableConclusions: observable,
    needsHumanConfirmation: confirmation,
    notEvaluable: notEvaluable,
    sourceRecordIds: [...sourceIds],
    thresholdSetId: input.thresholdSet.id,
    thresholdSetVersion: input.thresholdSet.version,
  };
}
