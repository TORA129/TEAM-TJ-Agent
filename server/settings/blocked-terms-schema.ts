import type { JsonObject, UUID } from '@/domain/persistence/models';
import { PublicApplicationError } from '@/server/public-errors';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_NAME = 200;
const MAX_TERM = 500;
const MAX_TERMS = 10_000;
const MAX_IMPORT = 1_000_000;

type RecordValue = Record<string, unknown>;

export type BlockedTermListCreateInput = {
  readonly name: string;
  readonly terms: readonly string[];
  readonly normalizationPolicy?: JsonObject;
  readonly importedFrom?: string;
  readonly editReason?: string;
};

export type BlockedTermListPatchInput = {
  readonly id: UUID;
  readonly terms?: readonly string[];
  readonly name?: string;
  readonly normalizationPolicy?: JsonObject;
  readonly importedFrom?: string;
  readonly editReason: string;
};

function invalid(fieldErrors: Readonly<Record<string, readonly string[]>>): never {
  throw new PublicApplicationError({ code: 'VALIDATION_FAILED', fieldErrors });
}

function object(value: unknown, field = 'body'): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid({ [field]: ['Provide a JSON object.'] });
  return value as RecordValue;
}

function stringValue(
  value: unknown,
  field: string,
  max: number,
  required = false,
): string | undefined {
  if (value === undefined || value === null) {
    if (required) invalid({ [field]: ['This field is required.'] });
    return undefined;
  }
  if (typeof value !== 'string') invalid({ [field]: ['Use a string value.'] });
  if (value.length > max) invalid({ [field]: [`Use no more than ${max} characters.`] });
  if (required && !value.trim()) invalid({ [field]: ['This field is required.'] });
  return value;
}

function terms(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) invalid({ [field]: ['Use an array of terms.'] });
  if (value.length > MAX_TERMS) invalid({ [field]: [`Use no more than ${MAX_TERMS} terms.`] });
  const result = value.map((term, index) => {
    if (typeof term !== 'string') invalid({ [`${field}.${index}`]: ['Use a string value.'] });
    if (term.length > MAX_TERM)
      invalid({ [`${field}.${index}`]: [`Use no more than ${MAX_TERM} characters.`] });
    if (!term.trim()) invalid({ [`${field}.${index}`]: ['A term cannot be empty.'] });
    return term;
  });
  return [...new Set(result.map((term) => term.normalize('NFKC').trim()).filter(Boolean))];
}

function policy(value: unknown): JsonObject | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid({ normalizationPolicy: ['Use a JSON object.'] });
  return value as JsonObject;
}

export function parseBlockedTermListCreateInput(value: unknown): BlockedTermListCreateInput {
  const body = object(value);
  const name = stringValue(body.name, 'name', MAX_NAME, true)!;
  const rawTerms = body.terms ?? importTerms(body.content, 'content');
  if (rawTerms === undefined) invalid({ terms: ['Provide terms or import content.'] });
  return {
    name,
    terms: terms(rawTerms, 'terms'),
    ...(policy(body.normalizationPolicy)
      ? { normalizationPolicy: policy(body.normalizationPolicy) }
      : {}),
    ...(stringValue(body.importedFrom, 'importedFrom', MAX_IMPORT)
      ? { importedFrom: stringValue(body.importedFrom, 'importedFrom', MAX_IMPORT) }
      : {}),
    ...(stringValue(body.editReason, 'editReason', 500)
      ? { editReason: stringValue(body.editReason, 'editReason', 500) }
      : {}),
  };
}

export function parseBlockedTermListPatchInput(
  value: unknown,
  idFromRoute?: string,
): BlockedTermListPatchInput {
  const body = object(value);
  const id = idFromRoute ?? stringValue(body.id, 'id', 128, true)!;
  if (!SAFE_ID.test(id)) invalid({ id: ['Use a safe identifier.'] });
  const editReason = stringValue(body.editReason, 'editReason', 500, true)!;
  const parsedTerms =
    body.terms === undefined && body.content === undefined
      ? undefined
      : terms(body.terms ?? importTerms(body.content, 'content'), 'terms');
  const name = stringValue(body.name, 'name', MAX_NAME);
  if (name !== undefined && !name.trim()) invalid({ name: ['Use a non-empty name.'] });
  return {
    id,
    ...(name !== undefined ? { name } : {}),
    ...(parsedTerms !== undefined ? { terms: parsedTerms } : {}),
    ...(policy(body.normalizationPolicy)
      ? { normalizationPolicy: policy(body.normalizationPolicy) }
      : {}),
    ...(stringValue(body.importedFrom, 'importedFrom', MAX_IMPORT)
      ? { importedFrom: stringValue(body.importedFrom, 'importedFrom', MAX_IMPORT) }
      : {}),
    editReason,
  };
}

export function parseBlockedTermListId(value: string | null | undefined): UUID {
  if (!value || !SAFE_ID.test(value)) invalid({ id: ['A safe list identifier is required.'] });
  return value;
}

function importTerms(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') invalid({ [field]: ['Use newline-delimited import text.'] });
  if (value.length > MAX_IMPORT)
    invalid({ [field]: [`Use no more than ${MAX_IMPORT} characters.`] });
  return value
    .split(/\r?\n|,/)
    .map((term) => term.trim())
    .filter(Boolean);
}
