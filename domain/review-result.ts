import type {
  ColorConclusion,
  MetricAssessment,
  MetricType,
  ReviewRecommendation,
  UUID,
} from './persistence/models';

export interface ReviewContentContext {
  readonly summary: string;
  readonly title?: string;
  readonly cover?: string;
  readonly opening?: string;
  readonly firstThreeLines?: string;
  readonly painPoint?: string;
  readonly targetAudience?: string;
  readonly targetEmotion?: string;
  readonly method?: string;
  readonly parameters?: string;
  readonly interactionEnding?: string;
  readonly sourceRecordIds: readonly UUID[];
  readonly available?: boolean;
}

export interface ReviewResultInput {
  readonly reviewDate: Date;
  readonly topic: string;
  readonly content: ReviewContentContext;
  readonly metricAssessments: readonly MetricAssessment[];
  readonly colorConclusion: ColorConclusion;
  readonly coreExcellentCount: number;
  readonly operatorMarkedLowCompletionRate?: boolean;
}

export interface ReviewResultOutput {
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

const METRIC_LABELS: Readonly<Record<MetricType, string>> = {
  EXPOSURE: '曝光',
  CTR: '点击率',
  READ_SECONDS: '阅读时长',
  COMPLETION_RATE: '完播率',
  LIKE_RATE: '点赞率',
  SAVE_RATE: '收藏率',
  COMMENT_RATE: '评论率',
  FOLLOWERS: '涨粉数',
};

const METRIC_ORDER: readonly MetricType[] = [
  'EXPOSURE',
  'CTR',
  'READ_SECONDS',
  'COMPLETION_RATE',
  'LIKE_RATE',
  'SAVE_RATE',
  'COMMENT_RATE',
  'FOLLOWERS',
];

const ANCHORS: Readonly<Record<string, readonly string[]>> = {
  CTR: ['封面', '封面标题', '标题钩子', '首句'],
  READ_SECONDS: ['首句', '前 3 行', '具体痛点', '目标情绪', '可复制方法', '数字参数'],
  COMPLETION_RATE: ['内容节奏', '内容结构', '吸引点'],
  LIKE_RATE: ['具体痛点', '可复制方法', '数字参数', '真实缺点', '互动结尾', '内容结构'],
  SAVE_RATE: ['具体痛点', '可复制方法', '数字参数', '真实缺点', '互动结尾', '内容结构'],
  COMMENT_RATE: ['结尾互动引导', '目标人群', '目标情绪', '具体痛点', '标题钩子'],
};

const ACTIONS: Readonly<Record<string, string>> = {
  CTR: '重做封面并改写标题钩子，先把核心结果或反差放进封面标题，再用首句承接。',
  READ_SECONDS: '重写首句和前 3 行，先给结果/数字，再补具体痛点与可复制步骤，减少铺垫。',
  COMPLETION_RATE: '由 Operator 复核内容节奏、结构和吸引点，按人工标记的低表现段落重新编排。',
  LIKE_RATE: '强化具体痛点与可复制方法，补充数字参数或真实限制，并改写互动结尾。',
  SAVE_RATE: '把可复制方法、数字参数和注意事项整理成可回看结构，并补充明确保存价值。',
  COMMENT_RATE: '在结尾针对目标人群和目标情绪提出具体问题，使用标题钩子或痛点引导真实回应。',
};

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function formatValue(assessment: MetricAssessment): string {
  if (assessment.value === undefined) return '未提供';
  if (assessment.unit === 'BASIS_POINTS') return `${(assessment.value / 100).toFixed(2)}%`;
  if (assessment.unit === 'SECONDS') return `${assessment.value} 秒`;
  return String(assessment.value);
}

function assessmentMap(assessments: readonly MetricAssessment[]) {
  return new Map(assessments.map((assessment) => [assessment.metricType, assessment]));
}

function isBelowRateThreshold(
  assessment: MetricAssessment,
  thresholdBasisPoints: number,
): boolean {
  return assessment.unit === 'BASIS_POINTS' && assessment.value !== undefined
    ? assessment.value < thresholdBasisPoints
    : false;
}

function hasLowRecommendation(
  type: MetricType,
  assessment: MetricAssessment | undefined,
  markedLowCompletion: boolean,
): boolean {
  if (!assessment) return false;
  if (type === 'COMPLETION_RATE') return markedLowCompletion;
  if (assessment.value === undefined) return false;
  if (type === 'CTR') return isBelowRateThreshold(assessment, 900);
  if (type === 'READ_SECONDS')
    return assessment.unit === 'SECONDS' && assessment.value < 10;
  if (type === 'LIKE_RATE') return isBelowRateThreshold(assessment, 1000);
  if (type === 'SAVE_RATE') return isBelowRateThreshold(assessment, 300);
  if (type === 'COMMENT_RATE') return isBelowRateThreshold(assessment, 100);
  return false;
}

function availableAnchors(content: ReviewContentContext, type: MetricType): string[] {
  const values: Partial<Record<string, string | undefined>> = {
    封面: content.cover,
    封面标题: content.title,
    标题钩子: content.title,
    首句: content.opening,
    '前 3 行': content.firstThreeLines,
    具体痛点: content.painPoint,
    目标情绪: content.targetEmotion,
    目标人群: content.targetAudience,
    可复制方法: content.method,
    数字参数: content.parameters,
    真实缺点: content.summary,
    互动结尾: content.interactionEnding,
    结尾互动引导: content.interactionEnding,
    内容节奏: content.summary,
    内容结构: content.summary,
    吸引点: content.summary,
  };
  return ANCHORS[type].filter((anchor) => Boolean(values[anchor]));
}

function recommendationFor(
  type: MetricType,
  assessment: MetricAssessment,
  content: ReviewContentContext,
): ReviewRecommendation {
  const anchors = availableAnchors(content, type);
  return {
    metricType: type,
    value: assessment.value,
    triggerRule: assessment.triggerRuleId
      ? `${assessment.triggerRuleId}：${assessment.classification}`
      : assessment.classification,
    contentAnchors: anchors.length ? anchors : ANCHORS[type],
    action: ACTIONS[type],
    sourceRecordIds: unique([
      ...(assessment.sourceRecordId ? [assessment.sourceRecordId] : []),
      ...content.sourceRecordIds,
    ]),
  };
}

function renderTemplate(
  input: ReviewResultInput,
  output: Omit<ReviewResultOutput, 'markdownTemplate'>,
): string {
  const map = assessmentMap(output.metricAssessments);
  const metricLines = METRIC_ORDER.map((type) => {
    const assessment = map.get(type);
    const label = METRIC_LABELS[type];
    if (!assessment || assessment.value === undefined)
      return `- **${label}**：{{${label}-需要人工输入}}（状态：需要人工输入；无法评估：{{${label}-无法评估}}）`;
    const outcome =
      type === 'COMPLETION_RATE' && assessment.classification === 'MANUAL_REVIEW'
        ? '供人工复盘'
        : assessment.classification;
    return `- **${label}**：{{${label}-值}}（实际值：${formatValue(assessment)}；来源：{{${label}-Source_Record}}；分层：${outcome}）`;
  }).join('\n');
  const conclusion =
    output.colorConclusion === 'GREEN'
      ? '绿色：笔记文案优秀'
      : output.colorConclusion === 'YELLOW'
        ? '黄色：笔记文案仍需改进'
        : '未生成颜色结论：{{核心指标-人工输入}}';
  return [
    '# 小红书笔记复盘模板',
    '',
    `## 日期\n{{复盘日期：${input.reviewDate.toISOString().slice(0, 10)}}}`,
    `## 笔记主题\n{{笔记主题：${input.topic || '待补充'}}}`,
    `## 封面或标题\n{{封面或标题：${input.content.cover || input.content.title || '待补充'}}}`,
    '## 八类指标',
    metricLines,
    '## 复盘结论',
    `- 总体结论：${conclusion}`,
    '- 好在哪：{{好在哪：请填写可复用优点}}',
    '- 差在哪：{{差在哪：请填写低表现原因}}',
    '## 下次改进点',
    '{{下次改进点：请填写下一篇的具体动作}}',
    '## 数据缺口',
    `- 可观察结论：${output.observableConclusions.join('；') || '暂无'}`,
    `- 需要人工确认：${output.needsHumanConfirmation.join('；') || '暂无'}`,
    `- 无法评估：${output.notEvaluable.join('；') || '暂无'}`,
    '## 来源',
    `{{Source_Record：${output.sourceRecordIds.join(', ') || '待补充'}}}`,
  ].join('\n');
}

export function buildReviewResult(input: ReviewResultInput): ReviewResultOutput {
  const map = assessmentMap(input.metricAssessments);
  const observableConclusions: string[] = [];
  const needsHumanConfirmation: string[] = [];
  const notEvaluable: string[] = [];
  const reasons: string[] = [];
  const recommendations: ReviewRecommendation[] = [];

  for (const type of METRIC_ORDER) {
    const assessment = map.get(type);
    const label = METRIC_LABELS[type];
    if (!assessment || assessment.value === undefined) {
      needsHumanConfirmation.push(`${label}：需要人工输入`);
      notEvaluable.push(`${label}：无法评估`);
      continue;
    }
    const outcome =
      type === 'COMPLETION_RATE' && assessment.classification === 'MANUAL_REVIEW'
        ? '供人工复盘'
        : assessment.classification;
    observableConclusions.push(`${label}：${formatValue(assessment)}，${outcome}`);
    if (assessment.boundary)
      needsHumanConfirmation.push(
        `${label}：${formatValue(assessment)}，阈值边界值需要 Operator 人工确认`,
      );
    if (type === 'COMPLETION_RATE' && assessment.classification === 'MANUAL_REVIEW')
      needsHumanConfirmation.push(`${label}：供人工复盘，系统未应用默认阈值`);
    if (hasLowRecommendation(type, assessment, Boolean(input.operatorMarkedLowCompletionRate))) {
      const recommendation = recommendationFor(type, assessment, input.content);
      recommendations.push(recommendation);
      reasons.push(
        `${label}触发低表现规则 ${recommendation.triggerRule}，关联锚点：${recommendation.contentAnchors.join('、')}`,
      );
    }
  }

  if (input.content.available === false || !input.content.summary.trim()) {
    notEvaluable.push('内容摘要：无法评估，未提供可审阅内容');
  } else {
    observableConclusions.push(`内容摘要：${input.content.summary}`);
  }

  const sourceRecordIds = unique([
    ...input.content.sourceRecordIds,
    ...input.metricAssessments.flatMap((assessment) =>
      assessment.sourceRecordId ? [assessment.sourceRecordId] : [],
    ),
  ]);
  const withoutTemplate = {
    contentSummary: input.content.summary || '未提供内容摘要',
    metricAssessments: input.metricAssessments,
    coreExcellentCount: input.coreExcellentCount,
    colorConclusion: input.colorConclusion,
    observableConclusions,
    needsHumanConfirmation: unique(needsHumanConfirmation),
    notEvaluable: unique(notEvaluable),
    reasons,
    recommendations,
    sourceRecordIds,
  };
  return { ...withoutTemplate, markdownTemplate: renderTemplate(input, withoutTemplate) };
}
