import { describe, expect, it } from 'vitest';
import type { ContentBriefVersion } from '@/domain/persistence/models';
import type { ModelCallResult, PiAiMessage, StructuredModelInput } from '@/server/pi-ai-model-adapter';
import {
  generateAndValidateCopyDraft,
  validateSourceRules,
  type CopyDraftCandidate,
} from '@/server/copywriter/draft-validation';

const brief: ContentBriefVersion = {
  id: 'brief-1', sessionId: 'session-1', version: 1, createdAt: new Date(), createdBy: 'SYSTEM',
  contentHash: 'hash', status: 'READY', blockedTermListIds: [], sourceRecordIds: ['source-1'],
  supplementaryFileIds: [], insightMemoryIds: [], operatorProvidedFields: [], missingFields: [],
  subject: 'ChatGPT 小红书教程', targetAudience: '新手运营', coreOutcome: '10分钟做出首稿',
  painPoint: '在办公室写选题时总卡住，无法快速产出', method: '使用 ChatGPT：1. 输入提示词；2. 设置 10 分钟和 3 步结构；3. 检查结果',
  parameters: '10分钟，3步，ChatGPT', realLimitation: '需要人工核对事实', closingAction: '按步骤检查后发布',
};

const candidate: CopyDraftCandidate = {
  targetAudience: '新手运营', targetEmotion: '好奇',
  titles: ['新手运营10分钟做出结果？以前错了，好奇', '新手运营3步做出成品，为什么，好奇', '新手运营10分钟不是慢，是方法错了，好奇', '新手运营用ChatGPT的3步效果，为什么，好奇', '新手运营今天做出首稿，为什么，好奇'],
  opening: '10分钟就能做出首稿，新手运营不是不会，是步骤错了。',
  firstThreeLines: '结果是10分钟做出首稿。成品已经完成，过程只有3步。',
  painPoint: '在办公室写选题时总卡住，无法快速产出。', method: 'ChatGPT 第1步输入提示词；第2步设置10分钟和3步结构；第3步检查结果。',
  realLimitation: '需要人工核对事实', body: '我用3步完成了首稿。✨ 先做结果，再补过程。🔍 现在新手运营也能复现。✅',
  bodyPoints: ['1️⃣ 先输入提示词并得到结果', '2️⃣ 再设置10分钟和3步结构', '3️⃣ 最后人工核对事实'],
  interactionEnding: '按这3步检查后再发布，保存这份清单。', tags: ['新手运营', '小红书', '内容创作', 'ChatGPT教程', '文案方法', '运营效率', '10分钟新手运营教程', '3步文案检查'],
  tagBuckets: { broad: ['新手运营', '小红书', '内容创作'], medium: ['ChatGPT教程', '文案方法', '运营效率'], longTail: ['10分钟新手运营教程', '3步文案检查'] },
  contentType: 'tutorial', sourceRecordIds: ['source-1'],
};

describe('Copy_Draft Source_Rules validation', () => {
  it('returns one deterministic result for all fourteen rules', () => {
    const result = validateSourceRules(candidate, brief);
    expect(result.ruleResults.map((item) => item.ruleId)).toEqual(
      Array.from({ length: 14 }, (_, index) => `SR-${String(index + 1).padStart(3, '0')}`),
    );
    expect(result.ruleResults.every((item) => ['PASS', 'FAIL', 'NEEDS_OPERATOR_CONFIRMATION'].includes(item.status))).toBe(true);
    expect(result.ruleResults.every((item) => item.sourceRulesHash.length === 64)).toBe(true);
    expect(result.rulesPassed).toBe(true);
  });

  it('marks missing unverifiable parameters as operator confirmation', () => {
    const result = validateSourceRules({ ...candidate, method: '使用工具完成步骤。' }, { ...brief, parameters: '' });
    expect(result.ruleResults.find((item) => item.ruleId === 'SR-009')?.status).toBe('NEEDS_OPERATOR_CONFIRMATION');
    expect(result.needsOperatorConfirmation).toBe(true);
  });

  it('repairs a rule failure exactly once and never loops', async () => {
    const calls: PiAiMessage[][] = [];
    let invocation = 0;
    const adapter: { generateStructured: <T>(input: StructuredModelInput<T>) => Promise<ModelCallResult<T>> } = {
      generateStructured: async <T>(input: StructuredModelInput<T>) => {
        calls.push([...input.messages]);
        invocation += 1;
        return {
          value: (invocation === 1 ? { ...candidate, interactionEnding: '请点赞并私信我' } : candidate) as T,
          text: '{}',
          metadata: { providerId: 'openrouter', modelId: 'test:free', requestId: String(invocation) },
        };
      },
    };
    const result = await generateAndValidateCopyDraft(adapter, { jobId: 'job-1', entityId: 'session-1', brief });
    expect(result.modelCalls).toBe(2);
    expect(result.repairAttempted).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.[1]?.content).toContain('SR-014');
    expect(result.manualEditingRequired).toBe(false);
  });
});
