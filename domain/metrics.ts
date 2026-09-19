import type {
  BoundaryAction,
  MetricOrigin,
  MetricThresholdRule,
  MetricThresholdSet,
  MetricType,
  MetricUnit,
} from './persistence/models';

export type MetricPresence = 'MISSING' | 'ZERO' | 'VALUE';

export interface MetricInput {
  readonly metricType: MetricType;
  readonly value?: number;
  readonly unit: MetricUnit;
  readonly origin?: MetricOrigin;
  readonly sourceRecordId?: string;
}

export interface MetricValueValidationInput {
  readonly metricType: MetricType;
  readonly value: number;
  readonly unit: MetricUnit;
  readonly origin: MetricOrigin;
  readonly sourceRecordId: string;
}

export type MetricClassification =
  | 'MISSING'
  | 'MANUAL_REVIEW'
  | 'BOUNDARY_CONFIRMATION'
  | 'EXCELLENT'
  | 'MEDIUM'
  | 'LOW'
  | 'GENERAL';

export interface MetricEvaluation {
  readonly metricType: MetricType;
  readonly presence: MetricPresence;
  readonly value?: number;
  readonly unit: MetricUnit;
  readonly classification: MetricClassification;
  readonly outcome: string;
  readonly boundary: boolean;
  readonly ruleId?: string;
}

export const DEFAULT_THRESHOLD_SET_ID = 'default-metric-threshold-set-v1';
export const DEFAULT_THRESHOLD_SET_VERSION = 1;

const COUNT_METRICS = new Set<MetricType>(['EXPOSURE', 'FOLLOWERS']);
const RATE_METRICS = new Set<MetricType>([
  'CTR',
  'COMPLETION_RATE',
  'LIKE_RATE',
  'SAVE_RATE',
  'COMMENT_RATE',
]);

function rule(
  id: string,
  thresholdSetId: string,
  metricType: MetricType,
  label: string,
  comparator: MetricThresholdRule['comparator'],
  outcome: string,
  boundaryAction: BoundaryAction = 'CLASSIFY',
  lowerValue?: number,
  upperValue?: number,
): MetricThresholdRule {
  const unit: MetricUnit = metricType === 'READ_SECONDS' ? 'SECONDS' : COUNT_METRICS.has(metricType) ? 'COUNT' : 'BASIS_POINTS';
  return {
    id,
    thresholdSetId,
    metricType,
    label,
    comparator,
    ...(lowerValue === undefined ? {} : { lowerValue }),
    ...(upperValue === undefined ? {} : { upperValue }),
    unit,
    boundaryAction,
    outcome,
    metadata: {},
  };
}

function defaultRules(thresholdSetId: string): readonly MetricThresholdRule[] {
  return [
    rule('exposure-excellent', thresholdSetId, 'EXPOSURE', '流量优秀', 'GT', '流量优秀且无任何违规', 'CLASSIFY', 5000),
    rule('exposure-medium', thresholdSetId, 'EXPOSURE', '流量中等', 'RANGE', '流量中等且无违规、内容质量不佳', 'CLASSIFY', 2000, 5000),
    rule('exposure-low', thresholdSetId, 'EXPOSURE', '流量低', 'RANGE', '流量低且无违规、内容质量严重不佳且可能有违规', 'CLASSIFY', 500, 2000),
    rule('exposure-account-check', thresholdSetId, 'EXPOSURE', '账号异常检查', 'RANGE', '检查账号异常或严重违规', 'CLASSIFY', 100, 500),
    rule('exposure-hidden', thresholdSetId, 'EXPOSURE', '隐藏笔记', 'LT', '隐藏笔记并进行养号操作', 'CLASSIFY', 100),
    rule('exposure-boundary-100', thresholdSetId, 'EXPOSURE', '曝光边界 100', 'EQ', '阈值边界值，需要 Operator 人工确认', 'OPERATOR_CONFIRMATION', 100),
    rule('exposure-boundary-500', thresholdSetId, 'EXPOSURE', '曝光边界 500', 'EQ', '阈值边界值，需要 Operator 人工确认', 'OPERATOR_CONFIRMATION', 500),
    rule('exposure-boundary-2000', thresholdSetId, 'EXPOSURE', '曝光边界 2000', 'EQ', '阈值边界值，需要 Operator 人工确认', 'OPERATOR_CONFIRMATION', 2000),
    rule('exposure-boundary-5000', thresholdSetId, 'EXPOSURE', '曝光边界 5000', 'EQ', '阈值边界值，需要 Operator 人工确认', 'OPERATOR_CONFIRMATION', 5000),
    rule('ctr-excellent', thresholdSetId, 'CTR', '封面优秀', 'GT', '封面优秀', 'CLASSIFY', 1500),
    rule('ctr-medium', thresholdSetId, 'CTR', '封面改进', 'RANGE', '封面改进', 'CLASSIFY', 900, 1500),
    rule('ctr-low', thresholdSetId, 'CTR', '加强封面', 'LT', '加强封面', 'CLASSIFY', 900),
    rule('ctr-boundary', thresholdSetId, 'CTR', '点击率边界', 'EQ', '阈值边界值，需要 Operator 人工确认', 'OPERATOR_CONFIRMATION', 1500),
    rule('read-excellent', thresholdSetId, 'READ_SECONDS', '内容优质', 'GT', '内容优质', 'CLASSIFY', 20),
    rule('read-medium', thresholdSetId, 'READ_SECONDS', '内容一般', 'RANGE', '内容一般', 'CLASSIFY', 10, 20),
    rule('read-low', thresholdSetId, 'READ_SECONDS', '吸引点很少', 'LT', '吸引点很少', 'CLASSIFY', 10),
    rule('read-boundary', thresholdSetId, 'READ_SECONDS', '阅读时长边界', 'EQ', '阈值边界值，需要 Operator 人工确认', 'OPERATOR_CONFIRMATION', 20),
    rule('like-excellent', thresholdSetId, 'LIKE_RATE', '点赞优秀', 'GT', '点赞优秀', 'CLASSIFY', 1500),
    rule('like-medium', thresholdSetId, 'LIKE_RATE', '点赞一般', 'RANGE', '点赞一般', 'CLASSIFY', 1000, 1500),
    rule('like-low-interest', thresholdSetId, 'LIKE_RATE', '点赞少吸引点', 'RANGE', '点赞少吸引点', 'CLASSIFY', 500, 1000),
    rule('like-low', thresholdSetId, 'LIKE_RATE', '点赞极少吸引点', 'LT', '点赞极少吸引点', 'CLASSIFY', 500),
    rule('like-boundary', thresholdSetId, 'LIKE_RATE', '点赞率边界', 'EQ', '阈值边界值，需要 Operator 人工确认', 'OPERATOR_CONFIRMATION', 1500),
    rule('save-excellent', thresholdSetId, 'SAVE_RATE', '收藏优秀', 'GT', '收藏优秀', 'CLASSIFY', 1300),
    rule('save-medium', thresholdSetId, 'SAVE_RATE', '收藏一般', 'RANGE', '收藏一般', 'CLASSIFY', 300, 1300),
    rule('save-low', thresholdSetId, 'SAVE_RATE', '不值得收藏', 'LT', '不值得收藏', 'CLASSIFY', 300),
    rule('save-boundary', thresholdSetId, 'SAVE_RATE', '收藏率边界', 'EQ', '阈值边界值，需要 Operator 人工确认', 'OPERATOR_CONFIRMATION', 1300),
    rule('comment-excellent', thresholdSetId, 'COMMENT_RATE', '评论优秀', 'GT', '评论优秀', 'CLASSIFY', 500),
    rule('comment-medium', thresholdSetId, 'COMMENT_RATE', '评论一般', 'RANGE', '评论一般', 'CLASSIFY', 100, 500),
    rule('comment-low', thresholdSetId, 'COMMENT_RATE', '无评论吸引', 'LT', '无评论吸引', 'CLASSIFY', 100),
    rule('comment-boundary', thresholdSetId, 'COMMENT_RATE', '评论率边界', 'EQ', '阈值边界值，需要 Operator 人工确认', 'OPERATOR_CONFIRMATION', 500),
    rule('followers-excellent', thresholdSetId, 'FOLLOWERS', '涨粉优秀', 'GT', '涨粉优秀', 'CLASSIFY', 30),
    rule('followers-general', thresholdSetId, 'FOLLOWERS', '涨粉一般', 'LTE', '涨粉一般', 'CLASSIFY', 30),
  ];
}

export function createDefaultMetricThresholdSet(
  operatorId: string,
  now = new Date(),
): MetricThresholdSet {
  const id = DEFAULT_THRESHOLD_SET_ID;
  return {
    id,
    operatorId,
    version: DEFAULT_THRESHOLD_SET_VERSION,
    contentHash: `metric-thresholds-v${DEFAULT_THRESHOLD_SET_VERSION}`,
    createdAt: now,
    createdBy: 'SYSTEM',
    completionRatePolicy: 'UNDEFINED_UNLESS_OPERATOR_DEFINED',
    status: 'ACTIVE',
    rules: defaultRules(id),
  };
}

export function metricPresence(value: number | undefined): MetricPresence {
  if (value === undefined) return 'MISSING';
  return value === 0 ? 'ZERO' : 'VALUE';
}

export function validateMetricValue(input: MetricValueValidationInput): void {
  if (!Number.isFinite(input.value) || input.value < 0) {
    throw new MetricValidationError('value must be a finite non-negative number');
  }
  if (COUNT_METRICS.has(input.metricType)) {
    if (input.unit !== 'COUNT' || !Number.isSafeInteger(input.value)) {
      throw new MetricValidationError(`${input.metricType} must be a non-negative integer COUNT`);
    }
  } else if (RATE_METRICS.has(input.metricType)) {
    if (input.unit !== 'BASIS_POINTS' || !Number.isSafeInteger(input.value) || input.value > 10000) {
      throw new MetricValidationError(`${input.metricType} must be BASIS_POINTS from 0 through 10000`);
    }
  } else if (input.metricType === 'READ_SECONDS' && input.unit !== 'SECONDS') {
    throw new MetricValidationError('READ_SECONDS must use SECONDS');
  }
  if (!input.sourceRecordId.trim()) throw new MetricValidationError('sourceRecordId is required');
}

export function validateMetricInput(input: MetricInput): MetricPresence {
  if (input.value === undefined) return 'MISSING';
  if (input.origin === undefined) throw new MetricValidationError('origin is required for a supplied metric');
  if (!input.sourceRecordId?.trim()) throw new MetricValidationError('sourceRecordId is required for a supplied metric');
  validateMetricValue({ ...input, value: input.value, origin: input.origin, sourceRecordId: input.sourceRecordId });
  return metricPresence(input.value);
}

export function evaluateMetric(
  input: MetricInput,
  thresholdSet = createDefaultMetricThresholdSet('SYSTEM'),
): MetricEvaluation {
  const presence = validateMetricInput(input);
  if (presence === 'MISSING') {
    return { metricType: input.metricType, presence, unit: input.unit, classification: 'MISSING', outcome: '需要人工输入', boundary: false };
  }
  if (input.metricType === 'COMPLETION_RATE' && thresholdSet.completionRatePolicy === 'UNDEFINED_UNLESS_OPERATOR_DEFINED') {
    return { metricType: input.metricType, presence, value: input.value, unit: input.unit, classification: 'MANUAL_REVIEW', outcome: '供人工复盘', boundary: false };
  }
  const rules = thresholdSet.rules
    .filter((candidate) => candidate.metricType === input.metricType)
    .sort((left, right) => Number(right.boundaryAction === 'OPERATOR_CONFIRMATION') - Number(left.boundaryAction === 'OPERATOR_CONFIRMATION'));
  const match = rules.find((candidate) => matchesRule(input.value as number, candidate));
  if (!match) {
    if (input.metricType === 'EXPOSURE' && (input.value as number) >= 0 && (input.value as number) < 100) {
      return { metricType: input.metricType, presence, value: input.value, unit: input.unit, classification: 'LOW', outcome: '隐藏笔记并进行养号操作', boundary: false };
    }
    throw new MetricValidationError(`no threshold rule matches ${input.metricType}=${input.value}`);
  }
  return {
    metricType: input.metricType,
    presence,
    value: input.value,
    unit: input.unit,
    classification: match.boundaryAction === 'OPERATOR_CONFIRMATION' ? 'BOUNDARY_CONFIRMATION' : classificationFor(input.metricType, match),
    outcome: match.outcome,
    boundary: match.boundaryAction === 'OPERATOR_CONFIRMATION',
    ruleId: match.id,
  };
}

function matchesRule(value: number, candidate: MetricThresholdRule): boolean {
  switch (candidate.comparator) {
    case 'GT': return value > (candidate.lowerValue as number);
    case 'GTE': return value >= (candidate.lowerValue as number);
    case 'LT': return value < (candidate.lowerValue as number);
    case 'LTE': return value <= (candidate.lowerValue as number);
    case 'EQ': return value === (candidate.lowerValue as number);
    case 'RANGE': return value >= (candidate.lowerValue as number) && value < (candidate.upperValue as number);
  }
}

function classificationFor(metricType: MetricType, match: MetricThresholdRule): MetricClassification {
  if (metricType === 'FOLLOWERS' && match.label.includes('一般')) return 'GENERAL';
  if (match.label.includes('优秀') || (metricType === 'READ_SECONDS' && match.label === '内容优质')) return 'EXCELLENT';
  if (match.label.includes('一般') || match.label.includes('中等') || match.label.includes('改进')) return 'MEDIUM';
  return 'LOW';
}

export class MetricValidationError extends Error {
  readonly code = 'METRIC_VALIDATION_FAILED' as const;

  constructor(message: string) {
    super(message);
    this.name = 'MetricValidationError';
  }
}
