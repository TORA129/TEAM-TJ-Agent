import { describe, expect, it } from 'vitest';

import {
  createDefaultMetricThresholdSet,
  evaluateMetric,
  metricPresence,
  MetricValidationError,
  validateMetricValue,
} from '../domain/metrics';
import { evaluateReviewMetrics } from '../domain/review-metrics-evaluation';
import type { MetricThresholdSet } from '../domain/persistence/models';

const sourceRecordId = 'source-metric-1';

type MetricType = Parameters<typeof evaluateMetric>[0]['metricType'];
type MetricUnit = Parameters<typeof evaluateMetric>[0]['unit'];

function metric(metricType: MetricType, value: number, unit: MetricUnit) {
  return { metricType, value, unit, origin: 'MANUAL' as const, sourceRecordId };
}

function reviewMetric(metricType: MetricType, value: number, unit: MetricUnit, version = 1) {
  return {
    id: `metric-${metricType}-${version}`,
    reviewId: 'review-1',
    metricType,
    value,
    unit,
    origin: 'MANUAL' as const,
    sourceRecordId: `source-${metricType}-${version}`,
    enteredAt: new Date('2025-01-01T00:00:00.000Z'),
    version,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    createdBy: 'operator-1',
    contentHash: `hash-${metricType}-${version}`,
  };
}

describe('metric thresholds', () => {
  it('creates the default strict threshold set without a completion-rate threshold', () => {
    const thresholdSet = createDefaultMetricThresholdSet('operator-1');

    expect(thresholdSet.completionRatePolicy).toBe('UNDEFINED_UNLESS_OPERATOR_DEFINED');
    expect(thresholdSet.status).toBe('ACTIVE');
    expect(thresholdSet.rules).toHaveLength(32);
    expect(thresholdSet.rules.some((rule) => rule.metricType === 'COMPLETION_RATE')).toBe(false);
  });

  it('distinguishes missing, zero, and non-zero metric values', () => {
    expect(metricPresence(undefined)).toBe('MISSING');
    expect(metricPresence(0)).toBe('ZERO');
    expect(metricPresence(1)).toBe('VALUE');
    expect(evaluateMetric({ metricType: 'EXPOSURE', unit: 'COUNT' })).toMatchObject({
      presence: 'MISSING',
      classification: 'MISSING',
      outcome: '需要人工输入',
    });
    expect(evaluateMetric(metric('EXPOSURE', 0, 'COUNT'))).toMatchObject({
      presence: 'ZERO',
      classification: 'LOW',
      outcome: '隐藏笔记并进行养号操作',
    });
  });

  it('treats zero exposure as a supplied low value rather than an unmatched threshold', () => {
    expect(evaluateMetric(metric('EXPOSURE', 0, 'COUNT'))).toMatchObject({
      presence: 'ZERO',
      value: 0,
      classification: 'LOW',
      boundary: false,
      outcome: '隐藏笔记并进行养号操作',
    });
  });

  it('keeps every strict boundary in operator confirmation', () => {
    const cases = [
      ['EXPOSURE', 100, 'COUNT'],
      ['EXPOSURE', 500, 'COUNT'],
      ['EXPOSURE', 2000, 'COUNT'],
      ['EXPOSURE', 5000, 'COUNT'],
      ['CTR', 1500, 'BASIS_POINTS'],
      ['READ_SECONDS', 20, 'SECONDS'],
      ['LIKE_RATE', 1500, 'BASIS_POINTS'],
      ['SAVE_RATE', 1300, 'BASIS_POINTS'],
      ['COMMENT_RATE', 500, 'BASIS_POINTS'],
    ] as const;

    for (const [metricType, value, unit] of cases) {
      expect(evaluateMetric(metric(metricType, value, unit))).toMatchObject({
        classification: 'BOUNDARY_CONFIRMATION',
        boundary: true,
        outcome: '阈值边界值，需要 Operator 人工确认',
      });
    }
  });

  it('applies strict interval semantics around representative thresholds', () => {
    expect(evaluateMetric(metric('EXPOSURE', 5001, 'COUNT')).classification).toBe('EXCELLENT');
    expect(evaluateMetric(metric('EXPOSURE', 3000, 'COUNT')).classification).toBe('MEDIUM');
    expect(evaluateMetric(metric('EXPOSURE', 700, 'COUNT')).classification).toBe('LOW');
    expect(evaluateMetric(metric('EXPOSURE', 100, 'COUNT')).boundary).toBe(true);
    expect(evaluateMetric(metric('CTR', 899, 'BASIS_POINTS')).classification).toBe('LOW');
    expect(evaluateMetric(metric('CTR', 900, 'BASIS_POINTS')).classification).toBe('MEDIUM');
    expect(evaluateMetric(metric('READ_SECONDS', 10, 'SECONDS')).classification).toBe('MEDIUM');
    expect(evaluateMetric(metric('FOLLOWERS', 30, 'COUNT')).classification).toBe('GENERAL');
    expect(evaluateMetric(metric('FOLLOWERS', 31, 'COUNT')).classification).toBe('EXCELLENT');
  });

  it('marks completion rate for manual review when no operator rule exists', () => {
    expect(evaluateMetric(metric('COMPLETION_RATE', 8500, 'BASIS_POINTS'))).toMatchObject({
      presence: 'VALUE',
      classification: 'MANUAL_REVIEW',
      outcome: '供人工复盘',
      boundary: false,
    });
  });

  it('uses operator-defined completion-rate rules when the policy is enabled', () => {
    const base = createDefaultMetricThresholdSet('operator-1');
    const thresholdSet: MetricThresholdSet = {
      ...base,
      completionRatePolicy: 'OPERATOR_DEFINED',
      rules: [
        ...base.rules,
        {
          id: 'completion-excellent',
          thresholdSetId: base.id,
          metricType: 'COMPLETION_RATE',
          label: '完播优秀',
          comparator: 'GT',
          lowerValue: 8000,
          unit: 'BASIS_POINTS',
          boundaryAction: 'CLASSIFY',
          outcome: '完播优秀',
          metadata: {},
        },
      ],
    };

    expect(evaluateMetric(metric('COMPLETION_RATE', 8001, 'BASIS_POINTS'), thresholdSet)).toMatchObject({
      classification: 'EXCELLENT',
      outcome: '完播优秀',
      boundary: false,
      ruleId: 'completion-excellent',
    });
  });

  it('rejects negative, fractional count, invalid rate, and mismatched units', () => {
    const invalid = [
      () => validateMetricValue({ metricType: 'EXPOSURE', value: -1, unit: 'COUNT', origin: 'MANUAL', sourceRecordId }),
      () => validateMetricValue({ metricType: 'EXPOSURE', value: 1.5, unit: 'COUNT', origin: 'MANUAL', sourceRecordId }),
      () => validateMetricValue({ metricType: 'CTR', value: 10001, unit: 'BASIS_POINTS', origin: 'MANUAL', sourceRecordId }),
      () => validateMetricValue({ metricType: 'READ_SECONDS', value: 1, unit: 'COUNT', origin: 'MANUAL', sourceRecordId }),
      () => validateMetricValue({ metricType: 'LIKE_RATE', value: 10, unit: 'SECONDS', origin: 'MANUAL', sourceRecordId }),
    ];

    for (const validate of invalid) expect(validate).toThrow(MetricValidationError);
  });
});

describe('review metric aggregate evaluation', () => {
  it('keeps all seven core metrics missing out of the color conclusion', () => {
    const result = evaluateReviewMetrics({
      metricValues: [],
      thresholdSet: createDefaultMetricThresholdSet('operator-1'),
    });

    expect(result.metricAssessments).toHaveLength(8);
    expect(result.metricAssessments.every((item) => item.classification === 'MISSING')).toBe(true);
    expect(result.coreExcellentCount).toBe(0);
    expect(result.colorConclusion).toBeNull();
    expect(result.notEvaluable).toHaveLength(8);
  });

  it.each([
    [0, 'YELLOW'],
    [1, 'YELLOW'],
    [3, 'YELLOW'],
    [4, 'GREEN'],
    [7, 'GREEN'],
  ] as const)('counts exactly %i excellent core metrics and returns %s', (excellentCount, conclusion) => {
    const types = ['EXPOSURE', 'CTR', 'READ_SECONDS', 'LIKE_RATE', 'SAVE_RATE', 'COMMENT_RATE', 'FOLLOWERS'] as const;
    const values = types.map((metricType, index) => {
      const excellent = index < excellentCount;
      const value = metricType === 'EXPOSURE' ? (excellent ? 5001 : 0)
        : metricType === 'CTR' ? (excellent ? 1501 : 0)
          : metricType === 'READ_SECONDS' ? (excellent ? 21 : 0)
            : metricType === 'LIKE_RATE' ? (excellent ? 1501 : 0)
              : metricType === 'SAVE_RATE' ? (excellent ? 1301 : 0)
                : metricType === 'COMMENT_RATE' ? (excellent ? 501 : 0)
                  : (excellent ? 31 : 0);
      const unit = metricType === 'EXPOSURE' || metricType === 'FOLLOWERS' ? 'COUNT' : metricType === 'READ_SECONDS' ? 'SECONDS' : 'BASIS_POINTS';
      return reviewMetric(metricType, value, unit);
    });
    const result = evaluateReviewMetrics({ metricValues: values, thresholdSet: createDefaultMetricThresholdSet('operator-1') });
    expect(result.coreExcellentCount).toBe(excellentCount);
    expect(result.colorConclusion).toBe(conclusion);
  });

  it('does not let completion rate alter the seven-core aggregate and preserves audit fields', () => {
    const thresholdSet = createDefaultMetricThresholdSet('operator-1');
    const result = evaluateReviewMetrics({
      metricValues: [reviewMetric('EXPOSURE', 5001, 'COUNT', 3), reviewMetric('COMPLETION_RATE', 8500, 'BASIS_POINTS', 4)],
      thresholdSet,
    });
    const exposure = result.metricAssessments.find((item) => item.metricType === 'EXPOSURE')!;
    const completion = result.metricAssessments.find((item) => item.metricType === 'COMPLETION_RATE')!;
    expect(result.coreExcellentCount).toBe(1);
    expect(result.colorConclusion).toBe('YELLOW');
    expect(completion.classification).toBe('MANUAL_REVIEW');
    expect(exposure).toMatchObject({ sourceRecordId: 'source-EXPOSURE-3', metricVersion: 3, thresholdSetVersion: thresholdSet.version, boundary: false });
    expect(result.sourceRecordIds).toEqual(['source-EXPOSURE-3', 'source-COMPLETION_RATE-4']);
  });

  it('uses the latest metric version per type and preserves its audit metadata', () => {
    const thresholdSet = createDefaultMetricThresholdSet('operator-1');
    const older = reviewMetric('EXPOSURE', 5001, 'COUNT', 1);
    const latest = reviewMetric('EXPOSURE', 100, 'COUNT', 2);
    const result = evaluateReviewMetrics({ metricValues: [older, latest], thresholdSet });
    const exposure = result.metricAssessments.find((item) => item.metricType === 'EXPOSURE')!;

    expect(exposure).toMatchObject({
      value: 100,
      classification: 'BOUNDARY_CONFIRMATION',
      boundary: true,
      sourceRecordId: 'source-EXPOSURE-2',
      metricVersion: 2,
      thresholdSetVersion: thresholdSet.version,
      triggerRuleId: 'exposure-boundary-100',
    });
    expect(result.coreExcellentCount).toBe(0);
    expect(result.colorConclusion).toBe('YELLOW');
  });
});
