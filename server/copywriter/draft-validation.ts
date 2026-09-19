import type { ContentBriefVersion, UUID } from '@/domain/persistence/models';
import type { SourceRuleId, SourceRulesSnapshot } from '@/domain/source-rules';
import { read_source_rules } from '@/server/source-rules';
import type { ModelCallResult, PiAiMessage, StructuredModelInput } from '@/server/pi-ai-model-adapter';
import type { PiAiModelAdapter } from '@/server/pi-ai-model-adapter';

export type RuleCheckStatus = 'PASS' | 'FAIL' | 'NEEDS_OPERATOR_CONFIRMATION';

export interface CopyDraftCandidate {
  readonly targetAudience: string;
  readonly targetEmotion: string;
  readonly titles: readonly string[];
  readonly opening: string;
  readonly firstThreeLines: string;
  readonly painPoint: string;
  readonly method: string;
  readonly realLimitation: string;
  readonly body: string;
  readonly bodyPoints: readonly string[];
  readonly interactionEnding: string;
  readonly tags: readonly string[];
  readonly tagBuckets: {
    readonly broad: readonly string[];
    readonly medium: readonly string[];
    readonly longTail: readonly string[];
  };
  readonly contentType?: 'tutorial' | 'experience' | 'showcase';
  readonly sourceRecordIds: readonly UUID[];
}

export interface RuleCheckResult {
  readonly ruleId: SourceRuleId;
  readonly status: RuleCheckStatus;
  readonly message: string;
  readonly sourceRulesVersion: string;
  readonly sourceRulesHash: string;
  readonly field?: string;
}

export interface DraftValidationResult {
  readonly candidate: CopyDraftCandidate;
  readonly ruleResults: readonly RuleCheckResult[];
  readonly errors: readonly string[];
  readonly rulesPassed: boolean;
  readonly sourcesComplete: boolean;
  readonly needsOperatorConfirmation: boolean;
  readonly sourceRulesVersion: string;
  readonly sourceRulesHash: string;
}

export interface DraftGenerationInput {
  readonly jobId: string;
  readonly entityId: UUID;
  readonly brief: ContentBriefVersion;
  readonly sourceRecordId?: UUID;
  readonly traceId?: string;
  readonly snapshot?: SourceRulesSnapshot;
  readonly contentType?: CopyDraftCandidate['contentType'];
}

export interface DraftGenerationResult extends DraftValidationResult {
  readonly modelCalls: number;
  readonly repairAttempted: boolean;
  readonly manualEditingRequired: boolean;
  readonly modelMetadata?: ModelCallResult<CopyDraftCandidate>['metadata'];
}

const EMOTIONS = ['羡慕', '焦虑', '恐惧', '感动', '好奇', '收藏'] as const;
const GREETINGS = /^(你好|嗨|大家好|哈喽|hello|hi)[，,！!。\s]*/i;
const VAGUE_WORDS = /很多|很好|很久|一些|大量|提升不少|效果很好/;
const CONTRAST = /不是.{0,20}[，,，]?是|以前错了|突然通了|但其实|没想到|反而/;
const ACTION = /步骤|方法|可以|建议|记住|试试|保存|收藏|下一步|执行|检查|使用|输入|设置/;
const NUMBER_OR_TIME = /\d+(?:\.\d+)?\s*(?:%|秒|分钟|小时|天|周|个|步|元|块|次|万|w)?|今天|明天|分钟|小时|天/;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('candidate must be an object');
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${field} must be a non-empty string array`);
  }
  return value as string[];
}

export function parseCopyDraftCandidate(value: unknown): CopyDraftCandidate {
  const input = asRecord(value);
  const buckets = asRecord(input.tagBuckets);
  const candidate: CopyDraftCandidate = {
    targetAudience: stringValue(input.targetAudience, 'targetAudience'),
    targetEmotion: stringValue(input.targetEmotion, 'targetEmotion'),
    titles: stringArray(input.titles, 'titles'),
    opening: stringValue(input.opening, 'opening'),
    firstThreeLines: stringValue(input.firstThreeLines, 'firstThreeLines'),
    painPoint: stringValue(input.painPoint, 'painPoint'),
    method: stringValue(input.method, 'method'),
    realLimitation: stringValue(input.realLimitation, 'realLimitation'),
    body: stringValue(input.body, 'body'),
    bodyPoints: stringArray(input.bodyPoints, 'bodyPoints'),
    interactionEnding: stringValue(input.interactionEnding, 'interactionEnding'),
    tags: stringArray(input.tags, 'tags'),
    tagBuckets: {
      broad: stringArray(buckets.broad, 'tagBuckets.broad'),
      medium: stringArray(buckets.medium, 'tagBuckets.medium'),
      longTail: stringArray(buckets.longTail, 'tagBuckets.longTail'),
    },
    contentType: input.contentType === undefined ? undefined : input.contentType as CopyDraftCandidate['contentType'],
    sourceRecordIds: stringArray(input.sourceRecordIds, 'sourceRecordIds'),
  };
  if (candidate.contentType && !['tutorial', 'experience', 'showcase'].includes(candidate.contentType)) {
    throw new Error('contentType must be tutorial, experience, or showcase');
  }
  return candidate;
}

export const COPY_DRAFT_CANDIDATE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['targetAudience', 'targetEmotion', 'titles', 'opening', 'firstThreeLines', 'painPoint', 'method', 'realLimitation', 'body', 'bodyPoints', 'interactionEnding', 'tags', 'tagBuckets', 'sourceRecordIds'],
  properties: {
    targetAudience: { type: 'string' }, targetEmotion: { type: 'string' },
    titles: { type: 'array', minItems: 5, maxItems: 5, items: { type: 'string' } },
    opening: { type: 'string' }, firstThreeLines: { type: 'string' }, painPoint: { type: 'string' },
    method: { type: 'string' }, realLimitation: { type: 'string' }, body: { type: 'string' },
    bodyPoints: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' } },
    interactionEnding: { type: 'string' }, tags: { type: 'array', minItems: 8, maxItems: 8, items: { type: 'string' } },
    tagBuckets: { type: 'object' }, contentType: { type: 'string' }, sourceRecordIds: { type: 'array', items: { type: 'string' } },
  },
};

function chineseLength(value: string): number {
  return [...value].filter((char) => /[\u3400-\u9FFF]/u.test(char)).length;
}

function containsAny(value: string, terms: readonly string[]): boolean {
  return terms.some((term) => term.length > 0 && value.includes(term));
}

function hasAudience(candidate: CopyDraftCandidate, audience: string): boolean {
  return candidate.targetAudience === audience && [candidate.opening, ...candidate.titles, ...candidate.tags].some((value) => value.includes(audience));
}

function rule(status: RuleCheckStatus, ruleId: SourceRuleId, message: string, snapshot: SourceRulesSnapshot, field?: string): RuleCheckResult {
  return { ruleId, status, message, sourceRulesVersion: snapshot.version, sourceRulesHash: snapshot.hash, field };
}

export function validateSourceRules(candidate: CopyDraftCandidate, brief: ContentBriefVersion, snapshot = read_source_rules(), contentType = candidate.contentType): DraftValidationResult {
  const results: RuleCheckResult[] = [];
  const add = (id: SourceRuleId, status: RuleCheckStatus, message: string, field?: string) => results.push(rule(status, id, message, snapshot, field));
  const allText = [candidate.opening, candidate.firstThreeLines, candidate.painPoint, candidate.method, candidate.realLimitation, candidate.body, candidate.interactionEnding, ...candidate.titles, ...candidate.bodyPoints, ...candidate.tags].join('\n');
  const providedNumbers = brief.parameters.match(/\d+(?:\.\d+)?\s*(?:%|秒|分钟|小时|天|周|个|步|元|块|次|万|w)?/gi) ?? [];

  add('SR-001', candidate.titles.every((title) => title.includes(brief.targetAudience) && NUMBER_OR_TIME.test(title) && (containsAny(title, ['结果', '提升', '收入', '效果', ...EMOTIONS]) || title.length > 4)) ? 'PASS' : 'FAIL', '每个标题需包含目标人群、强结果/情绪和数字或时间。', 'titles');
  add('SR-002', candidate.titles.every((title) => CONTRAST.test(title) || /怎么|为什么|竟然|原来|却|才发现|？/.test(title)) ? 'PASS' : 'FAIL', '标题缺少信息缺口或认知反差。', 'titles');
  add('SR-003', !GREETINGS.test(candidate.opening) && (CONTRAST.test(candidate.opening) || NUMBER_OR_TIME.test(candidate.opening) || /场景|使用|价格|结论|结果/.test(candidate.opening)) ? 'PASS' : 'FAIL', '首句必须直接承接标题，不能寒暄。', 'opening');
  add('SR-004', /\d|结果|成品|收入|效果|对比|提升/.test(candidate.firstThreeLines) ? 'PASS' : 'FAIL', '前三行没有先呈现结果、成品、效果、数字或对比。', 'firstThreeLines');
  add('SR-005', hasAudience(candidate, brief.targetAudience) ? 'PASS' : 'FAIL', '标题、首句和标签未保持单一目标人群。', 'targetAudience');
  add('SR-006', EMOTIONS.includes(candidate.targetEmotion as typeof EMOTIONS[number]) && [candidate.titles.join(''), candidate.opening].some((value) => value.includes(candidate.targetEmotion)) ? 'PASS' : 'FAIL', '目标情绪必须恰好属于规则集合且有标题/首句证据。', 'targetEmotion');
  add('SR-007', /在|当|每次|面对|做|写|发布|工作|家里|办公室/.test(candidate.painPoint) && /却|但|麻烦|无法|不够|浪费|卡住|失败|担心|焦虑/.test(candidate.painPoint) ? 'PASS' : 'FAIL', '痛点需要是具体场景加具体麻烦。', 'painPoint');
  add('SR-008', /工具|软件|模型|AI|ChatGPT|Claude|Excel|剪映|Canva|步骤|第[一二三四五六七八九十\d]/i.test(candidate.method) && candidate.method.split(/\d+\.|第[一二三四五六七八九十]+步|；|\n/).filter(Boolean).length >= 2 ? 'PASS' : 'FAIL', '方法需要包含工具名称和可复现步骤。', 'method');
  add('SR-009', providedNumbers.length === 0 ? 'NEEDS_OPERATOR_CONFIRMATION' : (providedNumbers.every((value) => allText.includes(value)) && !VAGUE_WORDS.test(candidate.method) ? 'PASS' : 'FAIL'), providedNumbers.length ? '参数和数字必须保留原始具体值。' : 'Brief 未提供可核验的具体参数，需 Operator 确认。', 'parameters');
  add('SR-010', candidate.realLimitation.trim() === brief.realLimitation.trim() || (candidate.realLimitation.length > 0 && brief.realLimitation.length > 0 && candidate.realLimitation.includes(brief.realLimitation)) ? 'PASS' : 'NEEDS_OPERATOR_CONFIRMATION', '真实缺点必须能回溯到 Brief 来源。', 'realLimitation');
  add('SR-011', CONTRAST.test(candidate.titles.join(' ')) || CONTRAST.test(candidate.bodyPoints[0] ?? '') ? 'PASS' : 'FAIL', '标题或第一分点缺少反差/认知冲突。', 'titles');
  const selectedType = contentType ?? 'tutorial';
  const structurePass = selectedType === 'tutorial' ? candidate.bodyPoints.every((point) => /[一二三四五六七八九十\d]/.test(point)) : selectedType === 'experience' ? candidate.bodyPoints.every((point) => /^\s*[\-•·]/.test(point) || EMOJI.test(point)) : candidate.body.split(/\n+/).filter(Boolean).every((part) => part.length <= 80);
  add('SR-012', structurePass ? 'PASS' : 'FAIL', `内容类型 ${selectedType} 的结构不符合规则。`, 'bodyPoints');
  const knownEntity = [brief.subject, brief.method, brief.parameters].filter(Boolean).flatMap((value) => value.match(/ChatGPT|Claude|Canva|Excel|小红书|春节|国庆|品牌|工具/gi) ?? []).find(Boolean);
  add('SR-013', knownEntity ? (candidate.titles.concat(candidate.opening).some((value) => value.includes(knownEntity)) ? 'PASS' : 'FAIL') : 'NEEDS_OPERATOR_CONFIRMATION', knownEntity ? '已知品牌、工具或节日未在标题/首句引用。' : 'Brief 未明确已知实体，需 Operator 确认。', 'titles');
  add('SR-014', ACTION.test(candidate.interactionEnding) && !/点赞|私信/.test(candidate.interactionEnding) ? 'PASS' : 'FAIL', '结尾需要可行动信息，且不能要求点赞或私信。', 'interactionEnding');

  const errors = results.filter((result) => result.status === 'FAIL').map((result) => `${result.ruleId}: ${result.message}`);
  const confirmations = results.some((result) => result.status === 'NEEDS_OPERATOR_CONFIRMATION');
  const sourcesComplete = candidate.sourceRecordIds.length > 0 && candidate.sourceRecordIds.some((id) => brief.sourceRecordIds.includes(id));
  if (!sourcesComplete) errors.push('SOURCE_CLOSURE: candidate sourceRecordIds must include a source from the current brief.');
  return { candidate, ruleResults: results, errors, rulesPassed: errors.length === 0, sourcesComplete, needsOperatorConfirmation: confirmations || !sourcesComplete, sourceRulesVersion: snapshot.version, sourceRulesHash: snapshot.hash };
}

export function buildCopyDraftModelInput(input: DraftGenerationInput, messages: readonly PiAiMessage[]): StructuredModelInput<CopyDraftCandidate> {
  return {
    jobId: input.jobId,
    entityId: input.entityId,
    traceId: input.traceId,
    sourceRecordId: input.sourceRecordId,
    messages,
    output: { name: 'copy_draft_candidate', schema: COPY_DRAFT_CANDIDATE_SCHEMA, parse: parseCopyDraftCandidate },
  };
}

export async function generateAndValidateCopyDraft(adapter: Pick<PiAiModelAdapter, 'generateStructured'>, input: DraftGenerationInput): Promise<DraftGenerationResult> {
  const snapshot = input.snapshot ?? read_source_rules();
  const baseMessages: PiAiMessage[] = [
    { role: 'system', content: `Generate a structured Copy_Draft candidate using Source_Rules ${snapshot.version}. Never claim confirmation; preserve only brief facts.` },
    { role: 'user', content: JSON.stringify({ brief: input.brief, contentType: input.contentType }) },
  ];
  let calls = 0;
  let repairAttempted = false;
  let modelResult: ModelCallResult<CopyDraftCandidate>;
  try {
    modelResult = await adapter.generateStructured(buildCopyDraftModelInput(input, baseMessages));
    calls += 1;
  } catch (error) {
    calls += 1;
    repairAttempted = true;
    const repaired = await adapter.generateStructured(buildCopyDraftModelInput(input, [{ role: 'system', content: 'Repair the structured Copy_Draft candidate. Return only valid JSON matching the schema.' }, { role: 'user', content: `Errors only: ${error instanceof Error ? error.message : 'MODEL_OUTPUT_INVALID'}` }]));
    calls += 1;
    modelResult = repaired;
  }
  let validation = validateSourceRules(modelResult.value, input.brief, snapshot, input.contentType);
  if (validation.errors.length > 0 && !repairAttempted) {
    repairAttempted = true;
    const repaired = await adapter.generateStructured(buildCopyDraftModelInput(input, [{ role: 'system', content: 'Repair the structured Copy_Draft candidate once. Return only valid JSON matching the schema.' }, { role: 'user', content: `Errors only:\n${validation.errors.join('\n')}` }]));
    calls += 1;
    modelResult = repaired;
    validation = validateSourceRules(modelResult.value, input.brief, snapshot, input.contentType);
  }
  return { ...validation, modelCalls: calls, repairAttempted, manualEditingRequired: validation.errors.length > 0 || validation.needsOperatorConfirmation, modelMetadata: modelResult.metadata };
}
