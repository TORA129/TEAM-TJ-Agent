import type { ContentBriefFieldName, UUID } from '@/domain/persistence/models';
import { PublicApplicationError } from '@/server/public-errors';

export const CONTENT_BRIEF_FIELDS: readonly ContentBriefFieldName[] = [
  'subject',
  'targetAudience',
  'coreOutcome',
  'painPoint',
  'method',
  'parameters',
  'realLimitation',
  'closingAction',
] as const;

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_FIELD_LENGTH = 10_000;
const MAX_REASON_LENGTH = 500;

type UnknownRecord = Record<string, unknown>;

export type CopywriterBriefPatch = Partial<Record<ContentBriefFieldName, string>>;

export type CopywriterCreateInput = {
  readonly brief: CopywriterBriefPatch;
  readonly blockedTermListIds: readonly UUID[];
  readonly supplementaryFileIds: readonly UUID[];
  readonly insightMemoryIds: readonly UUID[];
  readonly operatorProvidedFields: readonly ContentBriefFieldName[];
  readonly editReason?: string;
};

export type CopywriterPatchInput = CopywriterCreateInput & {
  readonly expectedVersion?: number;
};

export type CopywriterBriefDto = Readonly<{
  readonly id: UUID;
  readonly sessionId: UUID;
  readonly version: number;
  readonly status: string;
  readonly subject: string;
  readonly targetAudience: string;
  readonly coreOutcome: string;
  readonly painPoint: string;
  readonly method: string;
  readonly parameters: string;
  readonly realLimitation: string;
  readonly closingAction: string;
  readonly missingFields: readonly ContentBriefFieldName[];
  readonly operatorProvidedFields: readonly ContentBriefFieldName[];
  readonly blockedTermListIds: readonly UUID[];
  readonly supplementaryFileIds: readonly UUID[];
  readonly insightMemoryIds: readonly UUID[];
  readonly sourceRecordIds: readonly UUID[];
  readonly contentHash: string;
  readonly editReason?: string;
  readonly editedBy?: UUID;
  readonly createdAt: string;
}>;

function invalid(fieldErrors: Readonly<Record<string, readonly string[]>>): never {
  throw new PublicApplicationError({ code: 'VALIDATION_FAILED', fieldErrors });
}

function record(value: unknown, field = 'body'): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid({ [field]: ['Provide a JSON object.'] });
  }
  return value as UnknownRecord;
}

function text(value: unknown, field: string, options: { readonly required?: boolean } = {}): string {
  if (value === undefined || value === null) {
    if (options.required) invalid({ [field]: ['This field is required.'] });
    return '';
  }
  if (typeof value !== 'string') invalid({ [field]: ['Use a string value.'] });
  if (value.length > MAX_FIELD_LENGTH) {
    invalid({ [field]: [`Use no more than ${MAX_FIELD_LENGTH} characters.`] });
  }
  return value;
}

function idList(value: unknown, field: string): UUID[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) invalid({ [field]: ['Use an array of identifiers.'] });
  const invalidIds = value.filter(
    (item) => typeof item !== 'string' || !SAFE_ID_PATTERN.test(item),
  );
  if (invalidIds.length > 0) invalid({ [field]: ['Every identifier must be safe and non-empty.'] });
  return [...new Set(value as string[])];
}

function fieldList(value: unknown, field: string): ContentBriefFieldName[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) invalid({ [field]: ['Use an array of Content_Brief field names.'] });
  const invalidFields = value.filter(
    (item) => !CONTENT_BRIEF_FIELDS.includes(item as ContentBriefFieldName),
  );
  if (invalidFields.length > 0) invalid({ [field]: ['Use only supported Content_Brief fields.'] });
  return [...new Set(value as ContentBriefFieldName[])];
}

function reason(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const parsed = text(value, 'editReason');
  if (!parsed.trim()) invalid({ editReason: ['Provide a non-empty edit reason.'] });
  if (parsed.length > MAX_REASON_LENGTH) {
    invalid({ editReason: [`Use no more than ${MAX_REASON_LENGTH} characters.`] });
  }
  return parsed;
}

function briefFromBody(body: UnknownRecord): { brief: CopywriterBriefPatch; supplied: ContentBriefFieldName[] } {
  const source = body.brief === undefined ? body : record(body.brief, 'brief');
  const brief: CopywriterBriefPatch = {};
  const supplied: ContentBriefFieldName[] = [];
  for (const field of CONTENT_BRIEF_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      brief[field] = text(source[field], `brief.${field}`);
      supplied.push(field);
    }
  }
  return { brief, supplied };
}

function parse(value: unknown, patch: boolean): CopywriterCreateInput | CopywriterPatchInput {
  const body = record(value);
  const parsedBrief = briefFromBody(body);
  const explicitOperatorFields = fieldList(body.operatorProvidedFields, 'operatorProvidedFields');
  const operatorProvidedFields = explicitOperatorFields.length
    ? explicitOperatorFields
    : parsedBrief.supplied;
  const result: CopywriterCreateInput = {
    brief: parsedBrief.brief,
    blockedTermListIds: idList(body.blockedTermListIds, 'blockedTermListIds'),
    supplementaryFileIds: idList(body.supplementaryFileIds, 'supplementaryFileIds'),
    insightMemoryIds: idList(body.insightMemoryIds, 'insightMemoryIds'),
    operatorProvidedFields,
    editReason: reason(body.editReason),
  };
  if (!patch) return result;
  const expectedVersion = body.expectedVersion;
  if (
    expectedVersion !== undefined &&
    (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 0)
  ) {
    invalid({ expectedVersion: ['Use a non-negative safe integer.'] });
  }
  return { ...result, expectedVersion: expectedVersion as number | undefined };
}

export function parseCopywriterCreateInput(value: unknown): CopywriterCreateInput {
  return parse(value, false) as CopywriterCreateInput;
}

export function parseCopywriterPatchInput(value: unknown): CopywriterPatchInput {
  return parse(value, true) as CopywriterPatchInput;
}

export type ClarificationAction = 'DIAGNOSE' | 'ANSWER' | 'DECLINE';

export type ClarificationInput =
  | { readonly action: 'DIAGNOSE' }
  | { readonly action: 'ANSWER'; readonly questionSetId: UUID; readonly answers: readonly unknown[] }
  | { readonly action: 'DECLINE'; readonly questionSetId: UUID; readonly editReason?: string };

function answers(value: unknown): [string | null, string | null, string | null] {
  if (!Array.isArray(value) || value.length !== 3) {
    invalid({ answers: ['Provide exactly three answers.'] });
  }
  return value.map((item, index) => {
    if (item === null || item === undefined) return null;
    return text(item, `answers.${index}`);
  }) as [string | null, string | null, string | null];
}

export function parseClarificationInput(value: unknown): ClarificationInput {
  const body = record(value);
  const action = body.action;
  if (action === 'DIAGNOSE') return { action };
  const questionSetId = text(body.questionSetId, 'questionSetId', { required: true });
  if (!SAFE_ID_PATTERN.test(questionSetId)) invalid({ questionSetId: ['Use a valid question-set identifier.'] });
  if (action === 'ANSWER') return { action, questionSetId, answers: answers(body.answers) };
  if (action === 'DECLINE') return { action, questionSetId, editReason: reason(body.editReason) };
  invalid({ action: ['Use DIAGNOSE, ANSWER, or DECLINE.'] });
}

export function validateExpectedVersion(value: number | undefined): number {
  if (value === undefined || !Number.isSafeInteger(value) || value < 0) {
    invalid({ expectedVersion: ['A non-negative expectedVersion is required for updates.'] });
  }
  return value;
}


export type CopywriterDraftEditInput = {
  readonly draft: Record<string, unknown>;
  readonly editReason: string;
};

export type CopywriterDraftGenerateInput = {
  readonly contentType?: 'tutorial' | 'experience' | 'showcase';
};

export type CopywriterConfirmInput = {
  readonly version?: number;
};

function draftObject(value: unknown): Record<string, unknown> {
  const body = record(value);
  const draft = body.draft === undefined ? body : record(body.draft, 'draft');
  return draft;
}

export function parseCopywriterDraftEditInput(value: unknown): CopywriterDraftEditInput {
  const body = record(value);
  return { draft: draftObject(value), editReason: reason(body.editReason) ?? invalid({ editReason: ['An edit reason is required.'] }) };
}

export function parseCopywriterDraftGenerateInput(value: unknown): CopywriterDraftGenerateInput {
  const body = record(value);
  const contentType = body.contentType;
  if (contentType !== undefined && contentType !== 'tutorial' && contentType !== 'experience' && contentType !== 'showcase') {
    invalid({ contentType: ['Use tutorial, experience, or showcase.'] });
  }
  return { contentType: contentType as CopywriterDraftGenerateInput['contentType'] };
}

export function parseCopywriterConfirmInput(value: unknown): CopywriterConfirmInput {
  const body = record(value);
  if (body.version !== undefined && (!Number.isSafeInteger(body.version) || (body.version as number) < 1)) {
    invalid({ version: ['Use a positive safe integer.'] });
  }
  return { version: body.version as number | undefined };
}

export type CoverGenerateInput = {
  readonly title: string;
  readonly visualStyle?: string;
  readonly whitespaceRequirements?: string;
  readonly limitationOrCaveat?: string;
  readonly illustrationDescription?: string;
  readonly logoText?: string;
};

export type CoverPatchInput = Partial<CoverGenerateInput> & { readonly editReason: string };

function coverText(value: unknown, field: string, required = false): string | undefined {
  if (value === undefined) {
    if (required) invalid({ [field]: ['This field is required.'] });
    return undefined;
  }
  const parsed = text(value, field);
  if (required && !parsed.trim()) invalid({ [field]: ['This field is required.'] });
  return parsed;
}

export function parseCoverGenerateInput(value: unknown): CoverGenerateInput {
  const body = record(value);
  return {
    title: coverText(body.title, 'title', true) as string,
    visualStyle: coverText(body.visualStyle, 'visualStyle'),
    whitespaceRequirements: coverText(body.whitespaceRequirements, 'whitespaceRequirements'),
    limitationOrCaveat: coverText(body.limitationOrCaveat, 'limitationOrCaveat'),
    illustrationDescription: coverText(body.illustrationDescription, 'illustrationDescription'),
    logoText: coverText(body.logoText, 'logoText'),
  };
}

export function parseCoverPatchInput(value: unknown): CoverPatchInput {
  const body = record(value);
  const editReason = reason(body.editReason);
  if (!editReason) invalid({ editReason: ['An edit reason is required.'] });
  const result: Record<string, string | undefined> = { editReason };
  for (const field of ['title', 'visualStyle', 'whitespaceRequirements', 'limitationOrCaveat', 'illustrationDescription', 'logoText'] as const) {
    if (Object.prototype.hasOwnProperty.call(body, field)) result[field] = coverText(body[field], field);
  }
  if (Object.keys(result).length === 1) invalid({ body: ['Provide at least one cover field to edit.'] });
  return result as CoverPatchInput;
}
