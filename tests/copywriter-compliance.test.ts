import { describe, expect, it } from 'vitest';
import type { PersistenceRepositories } from '../domain/persistence/repositories';
import type { SourceRecord } from '../domain/persistence/models';
import type { CopyDraftCandidate } from '../server/copywriter/draft-validation';
import { evaluateCopyDraftCompliance, normalizeComplianceText } from '../server/copywriter/compliance';

const id = (value: string) => value as SourceRecord['id'];

function candidate(overrides: Partial<CopyDraftCandidate> = {}): CopyDraftCandidate {
  return {
    targetAudience: '运营', targetEmotion: '好奇', titles: ['标题'], opening: '开头', firstThreeLines: '前三行',
    painPoint: '痛点', method: '使用工具完成步骤', realLimitation: '限制', body: '正文', bodyPoints: ['第一点', '第二点', '第三点'],
    interactionEnding: '收藏后执行', tags: ['标签一', '标签二', '标签三'], tagBuckets: { broad: ['a'], medium: ['b'], longTail: ['c'] },
    sourceRecordIds: [id('source-1')], ...overrides,
  };
}

function repositories(termLists: Record<string, { id: string; version: number; terms: string[] }> = {}): PersistenceRepositories {
  const sources = new Map<string, SourceRecord>([['source-1', { id: id('source-1'), createdAt: new Date(), createdBy: 'SYSTEM', sourceType: 'BRIEF_FIELD', sourceRef: 'brief', version: 1, capturedAt: new Date(), parentSourceRecordIds: [], accessLimitations: [], redactionStatus: 'NOT_REQUIRED' }]]);
  return {
    blockedTermLists: { getById: async (listId: string) => termLists[listId] ? { ...termLists[listId], operatorId: id('operator'), name: 'list', normalizationPolicy: {}, status: 'ACTIVE', contentHash: 'hash' } as never : null } as never,
    sourceRecords: { getById: async (sourceId: string) => sources.get(sourceId) ?? null } as never,
  } as unknown as PersistenceRepositories;
}

describe('copywriter compliance', () => {
  it('normalizes full-width and zero-width text', () => {
    expect(normalizeComplianceText('ＡＢＣ\u200B')).toBe('abc');
  });

  it('checks every required block across multiple lists and preserves list metadata', async () => {
    const result = await evaluateCopyDraftCompliance(candidate({ opening: '这里有禁词' }), { blockedTermListIds: [id('a'), id('b')], sourceRecordIds: [id('source-1')] }, repositories({ a: { id: 'a', version: 2, terms: ['禁词'] }, b: { id: 'b', version: 7, terms: ['标签二'] } }));
    expect(result.status).toBe('MATCHED');
    expect(result.checkedBlocks).toEqual(['titles', 'opening', 'body', 'bodyPoints', 'interactionEnding', 'tags']);
    expect(result.matches.map((match) => [match.block, match.sourceListId, match.sourceListVersion])).toEqual([['opening', 'a', 2], ['tags', 'b', 7]]);
  });

  it('returns not configured and marks unsupported claims for confirmation', async () => {
    const result = await evaluateCopyDraftCompliance(candidate({ body: '提升 20% 的效果' }), { blockedTermListIds: [], sourceRecordIds: [id('source-1')] }, repositories());
    expect(result.status).toBe('NOT_CONFIGURED');
    expect(result.claims[0]?.status).toBe('VERIFIED');
  });
});
