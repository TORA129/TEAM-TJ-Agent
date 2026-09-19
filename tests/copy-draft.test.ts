import { describe, expect, it } from 'vitest';

import {
  countEmoji,
  countHanCharacters,
  parseCopyDraftSchema,
  validateCopyDraftStructure,
  type CopyDraftStructure,
} from '../domain/copy-draft';

const validDraft: CopyDraftStructure = {
  targetAudience: '第一次做小红书的运营新人',
  targetEmotion: '好奇',
  titles: ['3步做出高点击封面？', '以前错了：封面不是越满越好', 'CTR 15%后我改了什么', '小预算也能做出清晰封面', '一个留白细节突然通了'],
  opening: '我把封面从满屏文字改成留白，7天后点击率更稳定。',
  firstThreeLines: '成品点击率从9%提升到15%。\n关键不是加字，而是删掉干扰。\n下面是我复用的3步。',
  painPoint: '赶在发布前塞入太多信息，读者看不清重点，点击也越来越少。',
  method: '用 Canva：1. 保留一个主标题；2. 留出30%空白；3. 用同一套颜色复用。参数和步骤按项目原样执行。',
  realLimitation: '这套方法不适合需要同时展示多个产品参数的长图。',
  body: '我以前总以为信息越多越专业，结果封面变得很挤。✨\n现在先删掉次要信息，再保留一个结果。🔎\n最后用同一套颜色复用，修改时间少了30分钟。✅\n这不是万能模板，但很适合快速测试。💡',
  bodyPoints: ['✨ 留白：先删掉次要信息，再保留一个结果。', '🔎 排版：让标题和成品保持明显层级。', '✅ 复用：固定颜色，减少每次修改时间。'],
  interactionEnding: '你会先删文字，还是先换颜色？可以把你的场景写下来。',
  tags: ['小红书运营', '内容创作', '封面设计', '小红书封面设计', '内容增长方法', '运营效率提升', '新人封面留白方法', '高点击率封面测试'],
  tagBuckets: {
    broad: ['小红书运营', '内容创作', '封面设计'],
    medium: ['小红书封面设计', '内容增长方法', '运营效率提升'],
    longTail: ['新人封面留白方法', '高点击率封面测试'],
  },
};

describe('Copy_Draft tokenizer', () => {
  it('counts Han characters without counting punctuation, Latin text, or emoji', () => {
    expect(countHanCharacters('你好，Team-TJ！✨')).toBe(2);
    expect(countEmoji('我喜欢✨和👍🏽')).toBe(2);
  });
});

describe('Copy_Draft structural validator', () => {
  it('accepts a draft with the required blocks and quotas', () => {
    const result = validateCopyDraftStructure(validDraft);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('rejects invalid array quotas and body constraints with field paths', () => {
    const result = validateCopyDraftStructure({
      ...validDraft,
      titles: [...validDraft.titles, '多余标题'],
      bodyPoints: ['没有Emoji开头', ...validDraft.bodyPoints.slice(1)],
      tags: validDraft.tags.slice(0, 7),
      body: '短文',
      interactionEnding: '请点赞并私信我',
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['titles', 'bodyPoints.0', 'tags', 'body', 'interactionEnding']),
    );
  });

  it('rejects greetings, forbidden title terms, and inconsistent tag buckets', () => {
    const result = validateCopyDraftStructure({
      ...validDraft,
      titles: ['分享一个方法✨反差', ...validDraft.titles.slice(1)],
      opening: '大家好，今天分享一个方法。',
      tags: [...validDraft.tags].reverse(),
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['FORBIDDEN_TERM', 'FORMAT']),
    );
  });

  it('parses an unknown input into the typed structure only when valid', () => {
    const parsed = parseCopyDraftSchema(validDraft);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.titles).toHaveLength(5);

    const invalid = parseCopyDraftSchema({ ...validDraft, bodyPoints: ['only one'] });
    expect(invalid.success).toBe(false);
    expect(invalid.issues.some((issue) => issue.path === 'bodyPoints')).toBe(true);
  });
});
