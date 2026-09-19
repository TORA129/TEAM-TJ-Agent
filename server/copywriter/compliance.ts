import { randomUUID } from 'node:crypto';
import type {
  BlockedTermListVersion,
  ComplianceClaim,
  ComplianceMatch,
  ComplianceMatchStatus,
  ComplianceResult,
  SourceRecord,
  UUID,
} from '@/domain/persistence/models';
import type { PersistenceRepositories } from '@/domain/persistence/repositories';
import type { CopyDraftCandidate } from './draft-validation';

export const COMPLIANCE_BLOCKS = [
  'titles',
  'opening',
  'body',
  'bodyPoints',
  'interactionEnding',
  'tags',
] as const;
type ComplianceBlock = (typeof COMPLIANCE_BLOCKS)[number];

export function normalizeComplianceText(value: string): string {
  return value.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').toLowerCase();
}

function candidateBlocks(candidate: CopyDraftCandidate): Readonly<Record<ComplianceBlock, string>> {
  return {
    titles: candidate.titles.join('\n'),
    opening: candidate.opening,
    body: candidate.body,
    bodyPoints: candidate.bodyPoints.join('\n'),
    interactionEnding: candidate.interactionEnding,
    tags: candidate.tags.join('\n'),
  };
}

function occurrences(text: string, term: string): { readonly count: number; readonly spans: readonly [number, number][] } {
  if (!term) return { count: 0, spans: [] };
  const spans: [number, number][] = [];
  for (let from = 0; from <= text.length - term.length;) {
    const index = text.indexOf(term, from);
    if (index < 0) break;
    spans.push([index, index + term.length]);
    from = index + 1;
  }
  return { count: spans.length, spans };
}

export type ComplianceEvaluation = Readonly<{
  status: ComplianceMatchStatus;
  checkedBlocks: readonly string[];
  blockedTermListIds: readonly UUID[];
  matches: readonly ComplianceMatch[];
  claims: readonly Omit<ComplianceClaim, 'resultId'>[];
}>;

function claimText(block: ComplianceBlock, text: string): boolean {
  return block !== 'tags' && /\d|%|品牌|官方|案例|用户|效果|提升|收入|达到|实现|使用|工具|模型/i.test(text);
}

async function sourceClosure(candidate: CopyDraftCandidate, briefSourceRecordIds: readonly UUID[], repositories: PersistenceRepositories): Promise<readonly SourceRecord[]> {
  const ids = [...new Set([...candidate.sourceRecordIds, ...briefSourceRecordIds])];
  const records = await Promise.all(ids.map((id) => repositories.sourceRecords.getById(id)));
  return records.filter((record): record is SourceRecord => record !== null && ['BRIEF_FIELD', 'FILE', 'INSIGHT'].includes(record.sourceType));
}

export async function evaluateCopyDraftCompliance(
  candidate: CopyDraftCandidate,
  brief: { readonly blockedTermListIds: readonly UUID[]; readonly sourceRecordIds: readonly UUID[] },
  repositories: PersistenceRepositories,
): Promise<ComplianceEvaluation> {
  const lists: BlockedTermListVersion[] = [];
  for (const id of brief.blockedTermListIds) {
    const list = await repositories.blockedTermLists.getById(id);
    if (list) lists.push(list);
  }
  const blocks = candidateBlocks(candidate);
  const normalizedBlocks = Object.fromEntries(Object.entries(blocks).map(([block, text]) => [block, normalizeComplianceText(text)])) as Record<ComplianceBlock, string>;
  const matches: ComplianceMatch[] = [];
  for (const list of lists) {
    const seen = new Set<string>();
    for (const rawTerm of list.terms) {
      const normalizedTerm = normalizeComplianceText(rawTerm);
      if (!normalizedTerm || seen.has(normalizedTerm)) continue;
      seen.add(normalizedTerm);
      for (const block of COMPLIANCE_BLOCKS) {
        const found = occurrences(normalizedBlocks[block], normalizedTerm);
        if (found.count) matches.push({ id: randomUUID(), resultId: randomUUID(), term: rawTerm, normalizedTerm, block, occurrenceCount: found.count, sourceListId: list.id, sourceListVersion: list.version, span: { ranges: found.spans.map(([start, end]) => ({ start, end })) } });
      }
    }
  }

  const closedSources = await sourceClosure(candidate, brief.sourceRecordIds, repositories);
  const sourceIds = new Set(closedSources.map((source) => source.id));
  const claims: Omit<ComplianceClaim, 'resultId'>[] = [];
  for (const block of COMPLIANCE_BLOCKS) {
    const text = blocks[block];
    if (!claimText(block, text)) continue;
    const claimSources = candidate.sourceRecordIds.filter((id) => sourceIds.has(id));
    claims.push({ id: randomUUID(), claim: text, sourceRecordIds: claimSources, status: claimSources.length ? 'VERIFIED' : 'NEEDS_OPERATOR_CONFIRMATION' });
  }
  return { status: brief.blockedTermListIds.length === 0 ? 'NOT_CONFIGURED' : matches.length ? 'MATCHED' : 'NO_MATCH', checkedBlocks: [...COMPLIANCE_BLOCKS], blockedTermListIds: brief.blockedTermListIds, matches, claims };
}

export async function persistCopyDraftCompliance(repositories: PersistenceRepositories, targetVersionId: UUID, evaluation: ComplianceEvaluation): Promise<ComplianceResult> {
  const resultId = randomUUID();
  return repositories.complianceResults.create({ id: resultId, targetType: 'COPY_DRAFT', targetVersionId, status: evaluation.status, checkedBlocks: evaluation.checkedBlocks, blockedTermListIds: evaluation.blockedTermListIds, matches: evaluation.matches.map((match) => ({ ...match, resultId })), claims: evaluation.claims.map((claim) => ({ ...claim, resultId })) });
}

export function complianceRequiresOperatorConfirmation(evaluation: ComplianceEvaluation): boolean {
  return evaluation.status === 'MATCHED' || evaluation.claims.some((claim) => claim.status !== 'VERIFIED');
}
