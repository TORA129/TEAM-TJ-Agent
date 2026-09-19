import type { AccountMode, JsonObject, MetricType } from '@/domain/persistence/models';
import { PublicApplicationError } from '@/server/public-errors';

const MAX_TEXT = 100_000;
const METRIC_TYPES: readonly MetricType[] = [
  'EXPOSURE',
  'CTR',
  'READ_SECONDS',
  'COMPLETION_RATE',
  'LIKE_RATE',
  'SAVE_RATE',
  'COMMENT_RATE',
  'FOLLOWERS',
];
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

type RecordValue = Record<string, unknown>;
function invalid(fieldErrors: Record<string, readonly string[]>): never {
  throw new PublicApplicationError({ code: 'VALIDATION_FAILED', fieldErrors });
}
function asRecord(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid({ body: ['Provide a JSON object.'] });
  return value as RecordValue;
}
function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') invalid({ [field]: ['Use a string value.'] });
  if (value.length > MAX_TEXT) invalid({ [field]: [`Use no more than ${MAX_TEXT} characters.`] });
  const trimmed = value.trim();
  return trimmed || undefined;
}

export type NormalizedNoteUrl = Readonly<{ raw: string; normalized: string }>;
export function normalizeNoteUrl(value: unknown): NormalizedNoteUrl {
  if (typeof value !== 'string' || !value.trim()) invalid({ noteUrl: ['A Note_URL is required.'] });
  const raw = value.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    invalid({ noteUrl: ['Provide a valid HTTPS Xiaohongshu Note_URL.'] });
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    url.hostname !== 'www.xiaohongshu.com'
  )
    invalid({
      noteUrl: [
        'Only an HTTPS URL on www.xiaohongshu.com without credentials, query, or fragment is accepted.',
      ],
    });
  const path = url.pathname.replace(/\/+$/, '');
  if (!/^\/explore\/[^/]+$/.test(path))
    invalid({ noteUrl: ['Use an official Xiaohongshu /explore/{note-id} URL.'] });
  return { raw, normalized: `https://www.xiaohongshu.com${path}` };
}

function parseMetrics(value: unknown): JsonObject {
  if (value === undefined) return {};
  const record = asRecord(value);
  const result: Record<string, number> = {};
  for (const [key, metric] of Object.entries(record)) {
    if (!METRIC_TYPES.includes(key as MetricType))
      invalid({ [`metricValues.${key}`]: ['Use one of the supported metric types.'] });
    if (typeof metric !== 'number' || !Number.isFinite(metric) || metric < 0)
      invalid({
        [`metricValues.${key}`]: ['Use a finite non-negative number; zero is a valid value.'],
      });
    result[key] = metric;
  }
  return result;
}

export type InsightCheckRequest = Readonly<{
  selectedText: string;
  insightType: string;
  metricThresholdSetVersion: number;
  sourceRecordIds: readonly string[];
}>;
export type InsightSaveRequest = InsightCheckRequest & Readonly<{
  sourceNoteUrlOrManualInput: string;
  expectedInsightVersion?: number;
  editReason?: string;
}>;
function sourceIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) invalid({ sourceRecordIds: ['Provide at least one source record.'] });
  const ids = value.map((item, index) => requiredText(item, `sourceRecordIds.${index}`, 128));
  return [...new Set(ids)];
}
function thresholdVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) invalid({ metricThresholdSetVersion: ['Use a positive integer threshold version.'] });
  return value as number;
}
export function parseInsightCheckInput(value: unknown): InsightCheckRequest {
  const body = asRecord(value);
  return {
    selectedText: requiredText(body.selectedText, 'selectedText', MAX_TEXT),
    insightType: requiredText(body.insightType, 'insightType', 128),
    metricThresholdSetVersion: thresholdVersion(body.metricThresholdSetVersion),
    sourceRecordIds: sourceIds(body.sourceRecordIds),
  };
}
export function parseInsightSaveInput(value: unknown): InsightSaveRequest {
  const request = parseInsightCheckInput(value);
  const body = asRecord(value);
  const expectedInsightVersion = body.expectedInsightVersion === undefined ? undefined : thresholdVersion(body.expectedInsightVersion);
  const editReason = optionalText(body.editReason, 'editReason');
  return {
    ...request,
    sourceNoteUrlOrManualInput: requiredText(body.sourceNoteUrlOrManualInput, 'sourceNoteUrlOrManualInput', MAX_TEXT),
    ...(expectedInsightVersion !== undefined ? { expectedInsightVersion } : {}),
    ...(editReason ? { editReason } : {}),
  };
}

export type ManualContentRequest = Readonly<{
  title?: string;
  body?: string;
  coverDescription?: string;
  metricValues: JsonObject;
  editReason?: string;
}>;
export type ReviewCreateRequest = Readonly<{
  noteUrl?: NormalizedNoteUrl;
  manualContent?: ManualContentRequest;
}>;
export type AuthorizationConfirmationRequest = Readonly<{
  exactNoteUrl: NormalizedNoteUrl;
  toolId: string;
  purpose: string;
  accountMode: AccountMode;
  confirmedAt: Date;
  expiresAt?: Date;
}>;

export type FetchRequest = Readonly<{
  toolId: string;
  purpose: string;
  accountMode: AccountMode;
}>;

export function parseReviewFetchInput(value: unknown): FetchRequest {
  const body = asRecord(value);
  const toolId = requiredText(body.toolId, 'toolId', 128);
  const purpose = requiredText(body.purpose, 'purpose', 1_000);
  const accountMode = body.accountMode;
  if (accountMode !== 'AUTHORIZED_ACCOUNT' && accountMode !== 'PUBLIC_ACCESS')
    invalid({ accountMode: ['Use AUTHORIZED_ACCOUNT or PUBLIC_ACCESS.'] });
  return { toolId, purpose, accountMode };
}


function requiredText(value: unknown, field: string, max = 500): string {
  const result = optionalText(value, field);
  if (!result) invalid({ [field]: ['This field is required.'] });
  if (result.length > max) invalid({ [field]: [`Use no more than ${max} characters.`] });
  return result;
}
function dateValue(value: unknown, field: string, required: boolean): Date | undefined {
  if (value === undefined || value === null || value === '') {
    if (required) invalid({ [field]: ['A valid ISO date is required.'] });
    return undefined;
  }
  if (typeof value !== 'string') invalid({ [field]: ['Use an ISO date string.'] });
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) invalid({ [field]: ['Use a valid ISO date string.'] });
  return result;
}

export function parseAuthorizationConfirmationInput(
  value: unknown,
): AuthorizationConfirmationRequest {
  const body = asRecord(value);
  const exactNoteUrl = normalizeNoteUrl(body.exactNoteUrl);
  const toolId = requiredText(body.toolId, 'toolId', 128);
  const purpose = requiredText(body.purpose, 'purpose', 1_000);
  const accountMode = body.accountMode;
  if (accountMode !== 'AUTHORIZED_ACCOUNT' && accountMode !== 'PUBLIC_ACCESS')
    invalid({ accountMode: ['Use AUTHORIZED_ACCOUNT or PUBLIC_ACCESS.'] });
  const confirmedAt = dateValue(body.confirmedAt, 'confirmedAt', true)!;
  const expiresAt = dateValue(body.expiresAt, 'expiresAt', false);
  if (expiresAt && expiresAt <= confirmedAt)
    invalid({ expiresAt: ['Expiry must be later than confirmation time.'] });
  return {
    exactNoteUrl,
    toolId,
    purpose,
    accountMode,
    confirmedAt,
    ...(expiresAt ? { expiresAt } : {}),
  };
}

export function parseManualContentInput(value: unknown): ManualContentRequest {
  const body = asRecord(value);
  const title = optionalText(body.title, 'title');
  const content = optionalText(body.body, 'body');
  const coverDescription = optionalText(body.coverDescription, 'coverDescription');
  const editReason = optionalText(body.editReason, 'editReason');
  const metricValues = parseMetrics(body.metricValues);
  if (!title && !content && !coverDescription && Object.keys(metricValues).length === 0)
    invalid({
      manualContent: ['Provide title, body, coverDescription, or at least one metric value.'],
    });
  return {
    ...(title ? { title } : {}),
    ...(content ? { body: content } : {}),
    ...(coverDescription ? { coverDescription } : {}),
    metricValues,
    ...(editReason ? { editReason } : {}),
  };
}
export function parseReviewCreateInput(value: unknown): ReviewCreateRequest {
  const body = asRecord(value);
  const noteUrl = body.noteUrl === undefined ? undefined : normalizeNoteUrl(body.noteUrl);
  const manualContent =
    body.manualContent === undefined ? undefined : parseManualContentInput(body.manualContent);
  if (!noteUrl && !manualContent)
    invalid({ body: ['Provide a Note_URL or Manual_Content_Input.'] });
  return { ...(noteUrl ? { noteUrl } : {}), ...(manualContent ? { manualContent } : {}) };
}
export function parseReviewManualInput(value: unknown): ManualContentRequest {
  return parseManualContentInput(value);
}
export type MetricPatchItem = Readonly<{
  metricType: MetricType;
  value: number | null;
  unit: import('@/domain/persistence/models').MetricUnit;
}>;

export type MetricPatchRequest = Readonly<{
  metrics: readonly MetricPatchItem[];
  editReason?: string;
}>;

export type ThresholdPatchRequest = Readonly<{
  completionRatePolicy: 'UNDEFINED_UNLESS_OPERATOR_DEFINED' | 'OPERATOR_DEFINED';
  rules: readonly import('@/domain/persistence/models').MetricThresholdRule[];
  editReason?: string;
}>;

const UNITS = ['COUNT', 'BASIS_POINTS', 'SECONDS'] as const;
const COMPARATORS = ['GT', 'GTE', 'LT', 'LTE', 'EQ', 'RANGE'] as const;
const BOUNDARY_ACTIONS = ['CLASSIFY', 'OPERATOR_CONFIRMATION', 'UNDEFINED'] as const;

export type EvaluationRequest = Readonly<{ completionRateMarkedLow?: boolean }>;

export function parseEvaluationInput(value: unknown): EvaluationRequest {
  const body = asRecord(value);
  if (body.completionRateMarkedLow !== undefined && typeof body.completionRateMarkedLow !== 'boolean')
    invalid({ completionRateMarkedLow: ['Use a boolean value.'] });
  return body.completionRateMarkedLow === undefined ? {} : { completionRateMarkedLow: body.completionRateMarkedLow };
}

export function parseMetricPatchInput(value: unknown): MetricPatchRequest {
  const body = asRecord(value);
  if (!Array.isArray(body.metrics) || body.metrics.length === 0)
    invalid({ metrics: ['Provide at least one metric.'] });
  const metrics = body.metrics.map((item, index) => {
    const record = asRecord(item);
    const metricType = record.metricType;
    const unit = record.unit;
    if (!METRIC_TYPES.includes(metricType as MetricType)) invalid({ [`metrics.${index}.metricType`]: ['Use a supported metric type.'] });
    if (!UNITS.includes(unit as (typeof UNITS)[number])) invalid({ [`metrics.${index}.unit`]: ['Use COUNT, BASIS_POINTS, or SECONDS.'] });
    if (record.value !== null && (typeof record.value !== 'number' || !Number.isFinite(record.value))) invalid({ [`metrics.${index}.value`]: ['Use a finite number or null to delete the metric.'] });
    return { metricType: metricType as MetricType, unit: unit as import('@/domain/persistence/models').MetricUnit, value: record.value as number | null };
  });
  const editReason = optionalText(body.editReason, 'editReason');
  return { metrics, ...(editReason ? { editReason } : {}) };
}

export function parseThresholdPatchInput(value: unknown): ThresholdPatchRequest {
  const body = asRecord(value);
  const policy = body.completionRatePolicy;
  if (policy !== 'UNDEFINED_UNLESS_OPERATOR_DEFINED' && policy !== 'OPERATOR_DEFINED') invalid({ completionRatePolicy: ['Use a supported completion-rate policy.'] });
  if (!Array.isArray(body.rules)) invalid({ rules: ['Provide threshold rules.'] });
  const rules = body.rules.map((item, index) => {
    const record = asRecord(item);
    const requiredString = (field: string) => { const result = requiredText(record[field], `rules.${index}.${field}`, 500); return result; };
    const metricType = requiredString('metricType');
    const unit = requiredString('unit');
    const comparator = requiredString('comparator');
    const boundaryAction = requiredString('boundaryAction');
    if (!METRIC_TYPES.includes(metricType as MetricType)) invalid({ [`rules.${index}.metricType`]: ['Use a supported metric type.'] });
    if (!UNITS.includes(unit as (typeof UNITS)[number])) invalid({ [`rules.${index}.unit`]: ['Use a supported unit.'] });
    if (!COMPARATORS.includes(comparator as (typeof COMPARATORS)[number])) invalid({ [`rules.${index}.comparator`]: ['Use a supported comparator.'] });
    if (!BOUNDARY_ACTIONS.includes(boundaryAction as (typeof BOUNDARY_ACTIONS)[number])) invalid({ [`rules.${index}.boundaryAction`]: ['Use a supported boundary action.'] });
    const numberField = (field: string) => { const n = record[field]; if (n !== undefined && (typeof n !== 'number' || !Number.isFinite(n))) invalid({ [`rules.${index}.${field}`]: ['Use a finite number.'] }); return n as number | undefined; };
    return { id: requiredString('id'), thresholdSetId: 'pending', metricType: metricType as MetricType, label: requiredString('label'), comparator: comparator as import('@/domain/persistence/models').ThresholdComparator, lowerValue: numberField('lowerValue'), upperValue: numberField('upperValue'), unit: unit as import('@/domain/persistence/models').MetricUnit, boundaryAction: boundaryAction as import('@/domain/persistence/models').BoundaryAction, outcome: requiredString('outcome'), metadata: (record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata) ? record.metadata : {}) as import('@/domain/persistence/models').JsonObject };
  });
  const editReason = optionalText(body.editReason, 'editReason');
  return { completionRatePolicy: policy, rules, ...(editReason ? { editReason } : {}) };
}

export function validateRouteId(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value))
    invalid({ id: ['A valid review identifier is required.'] });
  return value;
}
