import { createHash } from 'node:crypto';

import type { SourceRule, SourceRulesSnapshot } from '../../../domain/source-rules';

const DEPLOYMENT_VERSION = '0.1.0';
const RULE_SET_VERSION = '1.0.0';
const SNAPSHOT_ID = 'team-tj-xiaohongshu-source-rules-v1';
const SOURCE_DOCUMENT = '小红书爆款思路.txt';
const SOURCE_SECTION = '爆款规则清单（14条，可直接照做）';

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalize(entryValue)}`);
    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nestedValue of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nestedValue);
    }
  }
  return value;
}

const sourceRules: readonly SourceRule[] = [
  {
    id: 'SR-001',
    order: 1,
    sourceText: '标题公式：具体对象/人群 + 强结果/强情绪 + 数字或时间。',
    normalizedRule:
      '标题必须同时包含具体对象或目标人群、强结果或强情绪，以及数字或时间中的至少一项。',
    executableChecks: [
      'title contains a concrete object or target audience',
      'title contains a strong result or strong emotion',
      'title contains a number or time expression',
    ],
  },
  {
    id: 'SR-002',
    order: 2,
    sourceText: '标题必须埋信息缺口或反差。',
    normalizedRule: '标题必须制造信息缺口或认知反差，让读者产生继续查看的理由。',
    executableChecks: [
      'title contains an information gap or contrast cue',
      'title does not resolve the full story before the body',
    ],
  },
  {
    id: 'SR-003',
    order: 3,
    sourceText: '首句不寒暄，直接承接标题做反转、结论或使用背景。',
    normalizedRule: '首句不得使用寒暄语，必须直接给出反转、结论、时间、价格或使用场景来承接标题。',
    executableChecks: [
      'opening does not begin with a greeting or pleasantry',
      'opening contains a reversal, conclusion, time, price, or usage context',
    ],
  },
  {
    id: 'SR-004',
    order: 4,
    sourceText: '前3行先给结果/成品/收入/效果，再补过程。',
    normalizedRule:
      '正文前 3 行必须先呈现结果、成品、收入、效果、数字或对比中的至少一项，再补充过程。',
    executableChecks: [
      'first three lines contain a result, finished work, income, effect, number, or comparison',
      'process context follows the initial result signal',
    ],
  },
  {
    id: 'SR-005',
    order: 5,
    sourceText: '每篇只锁定一个人群，标题+首句+标签重复同一人群词。',
    normalizedRule:
      '整篇内容只能服务 Content_Brief 指定的一个目标人群，标题、首句和标签应保持同一人群指向。',
    executableChecks: [
      'target audience is a single value from Content_Brief',
      'title, opening, and tags consistently address that audience',
    ],
  },
  {
    id: 'SR-006',
    order: 6,
    sourceText: '情绪必须明确选一种：羡慕、焦虑、恐惧、感动、好奇、收藏。',
    normalizedRule: '每篇内容必须从羡慕、焦虑、恐惧、感动、好奇、收藏中恰好选择一种目标情绪。',
    executableChecks: [
      'target emotion is exactly one of 羡慕/焦虑/恐惧/感动/好奇/收藏',
      'title or opening provides evidence for the selected emotion',
    ],
  },
  {
    id: 'SR-007',
    order: 7,
    sourceText: '痛点写成一句具体困扰，不写抽象痛点。',
    normalizedRule: '痛点必须写成具体的“场景 + 麻烦”困扰，不得只写抽象的用户需求或痛点标签。',
    executableChecks: [
      'pain point contains a concrete situation',
      'pain point names the resulting trouble or inconvenience',
    ],
  },
  {
    id: 'SR-008',
    order: 8,
    sourceText: '方法必须可复制：工具名+步骤+参数/口令/模型来源。',
    normalizedRule:
      '方法区必须可复制，并包含工具名称、步骤，以及 Content_Brief 提供的参数、口令或模型来源。',
    executableChecks: [
      'method names the tool or tools',
      'method contains ordered, reproducible steps',
      'provided parameters, prompts, or model sources are preserved verbatim',
    ],
  },
  {
    id: 'SR-009',
    order: 9,
    sourceText: '参数和数字越具体越可信。',
    normalizedRule: '能使用具体数字、单位、时间或范围时，必须使用原始具体值，不得替换为模糊量词。',
    executableChecks: [
      'available numeric facts are retained with their units or ranges',
      'content does not replace provided values with vague quantity words',
    ],
  },
  {
    id: 'SR-010',
    order: 10,
    sourceText: '主动保留一个真实缺点或瑕疵。',
    normalizedRule: '缺点区至少保留一个由 Content_Brief 支持的真实缺点、瑕疵、限制或注意事项。',
    executableChecks: [
      'real limitation is present',
      'limitation is traceable to Content_Brief or another allowed source record',
    ],
  },
  {
    id: 'SR-011',
    order: 11,
    sourceText: '反差/认知冲突放在标题或第一点。',
    normalizedRule:
      '标题或正文第一点必须出现反差或认知冲突，优先使用“不是 A，是 B”“以前错了”或“突然通了”等结构。',
    executableChecks: [
      'title or first body point contains a contrast or cognitive conflict',
      'contrast uses a recognizable reversal structure when applicable',
    ],
  },
  {
    id: 'SR-012',
    order: 12,
    sourceText: '结构分点：干货用1/2/3/4，体验用分点，展示用短句分段。',
    normalizedRule:
      '根据内容类型组织结构：干货使用编号步骤，体验使用分点，展示使用每段 1 至 2 行的短段落。',
    executableChecks: [
      'content type is identified before choosing the structure',
      'tutorial content uses numbered steps',
      'experience content uses bullet points',
      'showcase content uses short one- or two-line paragraphs',
    ],
  },
  {
    id: 'SR-013',
    order: 13,
    sourceText: '借势已知品牌/工具/节日，降低理解成本。',
    normalizedRule: '当 Content_Brief 提供已知品牌、工具或节日时，标题或首句必须引用一个相关实体。',
    executableChecks: [
      'known brand, tool, or holiday from Content_Brief is used when provided',
      'referenced entity is relevant to the topic',
    ],
  },
  {
    id: 'SR-014',
    order: 14,
    sourceText: '结尾给一个可收藏或可行动的信息，不强求点赞。',
    normalizedRule:
      '结尾必须提供一个可收藏或可执行的下一步，不得要求点赞，且不得使用“私信”作为互动动作。',
    executableChecks: [
      'ending contains a concrete actionable or saveable next step',
      'ending does not ask for likes',
      'ending does not use 私信 as the interaction action',
    ],
  },
];

const sourceHash = sha256(
  sourceRules.map(({ id, order, sourceText }) => ({ id, order, sourceText })),
);

const snapshotHashInput = {
  deploymentVersion: DEPLOYMENT_VERSION,
  ruleIds: sourceRules.map(({ id }) => id),
  rules: sourceRules,
  sourceDocument: SOURCE_DOCUMENT,
  sourceHash,
  sourceSection: SOURCE_SECTION,
  version: RULE_SET_VERSION,
};

const snapshotHash = sha256(snapshotHashInput);

export const SOURCE_RULES_SNAPSHOT_V1_0_0: SourceRulesSnapshot = deepFreeze({
  snapshotId: SNAPSHOT_ID,
  version: RULE_SET_VERSION,
  deploymentVersion: DEPLOYMENT_VERSION,
  sourceDocument: SOURCE_DOCUMENT,
  sourceSection: SOURCE_SECTION,
  sourceHash,
  hash: snapshotHash,
  contentHash: snapshotHash,
  ruleIds: sourceRules.map(({ id }) => id),
  rules: sourceRules,
});

export function calculateSourceRulesHash(snapshot: SourceRulesSnapshot): string {
  return sha256({
    deploymentVersion: snapshot.deploymentVersion,
    ruleIds: snapshot.ruleIds,
    rules: snapshot.rules,
    sourceDocument: snapshot.sourceDocument,
    sourceHash: snapshot.sourceHash,
    sourceSection: snapshot.sourceSection,
    version: snapshot.version,
  });
}
