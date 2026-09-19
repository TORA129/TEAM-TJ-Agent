import { describe, expect, it } from 'vitest';

import { buildReviewResult } from '../domain/review-result';
import type { MetricAssessment } from '../domain/persistence/models';

const content = {
  summary: '封面使用真实桌面照片，正文给出三步整理方法。',
  title: '3步整理桌面，终于不乱了',
  cover: '桌面整理前后对比',
  opening: '用了 10 分钟，桌面从堆满变得可用。',
  firstThreeLines: '先看结果，再做三步。',
  painPoint: '下班回家找不到充电线。',
  targetAudience: '经常加班的上班族',
  targetEmotion: '好奇',
  method: '使用收纳盒，按三步整理。',
  parameters: '10 分钟，3 个盒子',
  interactionEnding: '你最想先整理哪一处？',
  sourceRecordIds: ['source-content'],
};

function assessment(
  input: Partial<MetricAssessment> & Pick<MetricAssessment, 'metricType'>,
): MetricAssessment {
  return {
    metricType: input.metricType,
    value: input.value,
    unit: input.unit,
    sourceRecordId: input.sourceRecordId,
    classification: input.classification ?? 'LOW',
    boundary: input.boundary ?? false,
    triggerRuleId: input.triggerRuleId,
  };
}

describe('review result recommendations and template', () => {
  it('generates grounded low-performance recommendations with required fields', () => {
    const result = buildReviewResult({
      reviewDate: new Date('2026-01-02T00:00:00.000Z'),
      topic: '桌面整理',
      content,
      metricAssessments: [
        assessment({
          metricType: 'CTR',
          value: 850,
          unit: 'BASIS_POINTS',
          sourceRecordId: 'source-ctr',
          triggerRuleId: 'ctr-low',
        }),
        assessment({
          metricType: 'READ_SECONDS',
          value: 8,
          unit: 'SECONDS',
          sourceRecordId: 'source-read',
          triggerRuleId: 'read-low',
        }),
        assessment({
          metricType: 'COMPLETION_RATE',
          value: 2000,
          unit: 'BASIS_POINTS',
          sourceRecordId: 'source-completion',
          classification: 'MANUAL_REVIEW',
        }),
        assessment({
          metricType: 'LIKE_RATE',
          value: 400,
          unit: 'BASIS_POINTS',
          sourceRecordId: 'source-like',
          triggerRuleId: 'like-low',
        }),
        assessment({
          metricType: 'SAVE_RATE',
          value: 200,
          unit: 'BASIS_POINTS',
          sourceRecordId: 'source-save',
          triggerRuleId: 'save-low',
        }),
        assessment({
          metricType: 'COMMENT_RATE',
          value: 50,
          unit: 'BASIS_POINTS',
          sourceRecordId: 'source-comment',
          triggerRuleId: 'comment-low',
        }),
      ],
      colorConclusion: 'YELLOW',
      coreExcellentCount: 0,
      operatorMarkedLowCompletionRate: true,
    });

    expect(result.recommendations).toHaveLength(6);
    for (const recommendation of result.recommendations) {
      expect(recommendation.value).toBeTypeOf('number');
      expect(recommendation.triggerRule).not.toBe('');
      expect(recommendation.contentAnchors.length).toBeGreaterThan(0);
      expect(recommendation.action).not.toBe('');
      expect(recommendation.sourceRecordIds.length).toBeGreaterThan(0);
    }
    expect(
      result.recommendations.find((item) => item.metricType === 'CTR')?.sourceRecordIds,
    ).toEqual(expect.arrayContaining(['source-ctr', 'source-content']));
    expect(result.needsHumanConfirmation).toEqual(
      expect.arrayContaining(['完播率：供人工复盘，系统未应用默认阈值']),
    );
  });

  it('uses requirement thresholds rather than generic classification labels', () => {
    const baseInput = {
      reviewDate: new Date('2026-01-02T00:00:00.000Z'),
      topic: '阈值边界',
      content,
      colorConclusion: 'YELLOW' as const,
      coreExcellentCount: 0,
    };
    const result = buildReviewResult({
      ...baseInput,
      metricAssessments: [
        assessment({ metricType: 'CTR', value: 900, unit: 'BASIS_POINTS', classification: 'LOW' }),
        assessment({ metricType: 'READ_SECONDS', value: 10, unit: 'SECONDS', classification: 'LOW' }),
        assessment({ metricType: 'LIKE_RATE', value: 1000, unit: 'BASIS_POINTS', classification: 'LOW' }),
        assessment({ metricType: 'SAVE_RATE', value: 300, unit: 'BASIS_POINTS', classification: 'LOW' }),
        assessment({ metricType: 'COMMENT_RATE', value: 100, unit: 'BASIS_POINTS', classification: 'LOW' }),
      ],
    });

    expect(result.recommendations).toHaveLength(0);

    const belowThreshold = buildReviewResult({
      ...baseInput,
      metricAssessments: [
        assessment({ metricType: 'CTR', value: 899, unit: 'BASIS_POINTS' }),
        assessment({ metricType: 'READ_SECONDS', value: 9, unit: 'SECONDS' }),
        assessment({ metricType: 'LIKE_RATE', value: 999, unit: 'BASIS_POINTS' }),
        assessment({ metricType: 'SAVE_RATE', value: 299, unit: 'BASIS_POINTS' }),
        assessment({ metricType: 'COMMENT_RATE', value: 99, unit: 'BASIS_POINTS' }),
      ],
    });

    expect(belowThreshold.recommendations.map((item) => item.metricType)).toEqual([
      'CTR',
      'READ_SECONDS',
      'LIKE_RATE',
      'SAVE_RATE',
      'COMMENT_RATE',
    ]);
  });
  it('classifies missing metrics as manual input and not evaluable without inference', () => {
    const result = buildReviewResult({
      reviewDate: new Date('2026-01-02T00:00:00.000Z'),
      topic: '缺少指标',
      content: { summary: '只提供标题', title: '标题', sourceRecordIds: ['source-title'] },
      metricAssessments: [
        assessment({
          metricType: 'CTR',
          value: 800,
          unit: 'BASIS_POINTS',
          sourceRecordId: 'source-ctr',
        }),
      ],
      colorConclusion: null,
      coreExcellentCount: 0,
    });

    expect(result.needsHumanConfirmation).toEqual(
      expect.arrayContaining([
        '曝光：需要人工输入',
        '完播率：需要人工输入',
        '涨粉数：需要人工输入',
      ]),
    );
    expect(result.notEvaluable).toEqual(
      expect.arrayContaining(['曝光：无法评估', '完播率：无法评估', '涨粉数：无法评估']),
    );
    expect(result.observableConclusions.join('\n')).not.toContain('曝光：0');
    expect(
      result.recommendations.find((item) => item.metricType === 'CTR')?.contentAnchors,
    ).toEqual(expect.arrayContaining(['封面标题', '标题钩子']));
  });

  it('renders unique non-empty labeled placeholders for all required template sections', () => {
    const result = buildReviewResult({
      reviewDate: new Date('2026-01-02T00:00:00.000Z'),
      topic: '模板检查',
      content: { summary: '可观察内容摘要', title: '一个标题', sourceRecordIds: ['source-1'] },
      metricAssessments: [],
      colorConclusion: null,
      coreExcellentCount: 0,
    });
    const template = result.markdownTemplate;

    for (const heading of [
      '日期',
      '笔记主题',
      '封面或标题',
      '八类指标',
      '复盘结论',
      '下次改进点',
      '数据缺口',
      '来源',
    ]) {
      expect(template).toContain(`## ${heading}`);
    }
    for (const label of [
      '曝光',
      '点击率',
      '阅读时长',
      '完播率',
      '点赞率',
      '收藏率',
      '评论率',
      '涨粉数',
      '好在哪',
      '差在哪',
    ]) {
      expect(template).toContain(label);
    }
    expect(template).toMatch(/\{\{[^{}]+\}\}/);
    const labels = [...template.matchAll(/\{\{([^{}]+)\}\}/g)].map((match) => match[1]);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
