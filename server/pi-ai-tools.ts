import 'server-only';

import type { SourceRecord, SourceRecordType, UUID } from '../domain/persistence/models';
import { read_source_rules } from './source-rules';

/** The only tools that may be advertised to a pi-ai Agent. */
export const PI_AI_ALLOWED_TOOL_NAMES = Object.freeze([
  'read_source_rules',
  'read_brief_sources',
  'propose_copy_draft',
  'classify_review_text',
  'propose_recommendations',
  'compose_cover_visual',
] as const);

export type PiAiAllowedToolName = (typeof PI_AI_ALLOWED_TOOL_NAMES)[number];

const MAX_SOURCE_RECORDS = 32;
const MAX_TEXT_LENGTH = 80_000;
const MAX_PROPOSAL_KEYS = 32;

const FORBIDDEN_INPUT_KEYS = new Set([
  'account',
  'auth',
  'authorization',
  'command',
  'cookie',
  'credential',
  'env',
  'environment',
  'exec',
  'file',
  'filesystem',
  'headers',
  'login',
  'operation',
  'password',
  'publish',
  'queryUrl',
  'save',
  'secret',
  'shell',
  'token',
  'tool',
  'url',
  'write',
]);

export type PiAiToolErrorCode =
  | 'TOOL_NOT_ALLOWED'
  | 'TOOL_INPUT_INVALID'
  | 'TOOL_OUTPUT_INVALID'
  | 'SOURCE_RECORD_REQUIRED'
  | 'SOURCE_RECORD_NOT_FOUND'
  | 'TOOL_OPERATION_FORBIDDEN';

export interface PiAiToolErrorDTO {
  readonly code: PiAiToolErrorCode;
  readonly message: string;
  readonly action: 'EDIT_TOOL_INPUT' | 'USE_ALLOWED_TOOL' | 'PROVIDE_SOURCE_RECORD';
  readonly retryable: false;
  readonly toolName?: PiAiAllowedToolName;
}

/**
 * Public, safe error for the Agent boundary. It intentionally never includes
 * the rejected value, a path, a command, headers, credentials, or a stack.
 */
export class PiAiToolBoundaryError extends Error {
  readonly code: PiAiToolErrorCode;
  readonly toolName?: PiAiAllowedToolName;
  readonly retryable = false;

  constructor(input: {
    readonly code: PiAiToolErrorCode;
    readonly toolName?: PiAiAllowedToolName;
  }) {
    super(publicToolMessage(input.code));
    this.name = 'PiAiToolBoundaryError';
    this.code = input.code;
    this.toolName = input.toolName;
  }

  toDTO(): PiAiToolErrorDTO {
    const action: PiAiToolErrorDTO['action'] =
      this.code === 'TOOL_NOT_ALLOWED'
        ? 'USE_ALLOWED_TOOL'
        : this.code === 'SOURCE_RECORD_REQUIRED' || this.code === 'SOURCE_RECORD_NOT_FOUND'
          ? 'PROVIDE_SOURCE_RECORD'
          : 'EDIT_TOOL_INPUT';
    return {
      code: this.code,
      message: this.message,
      action,
      retryable: false,
      ...(this.toolName ? { toolName: this.toolName } : {}),
    };
  }
}

function publicToolMessage(code: PiAiToolErrorCode): string {
  switch (code) {
    case 'TOOL_NOT_ALLOWED':
      return 'This Agent tool is not available.';
    case 'TOOL_OPERATION_FORBIDDEN':
      return 'This operation is not available to Agent tools.';
    case 'SOURCE_RECORD_REQUIRED':
      return 'At least one valid Source_Record reference is required.';
    case 'SOURCE_RECORD_NOT_FOUND':
      return 'A referenced Source_Record could not be resolved.';
    case 'TOOL_OUTPUT_INVALID':
      return 'The Agent tool returned an invalid structured result.';
    case 'TOOL_INPUT_INVALID':
      return 'The Agent tool input is invalid.';
  }
}

export interface PiAiToolSchema {
  readonly type: 'object';
  readonly additionalProperties: false;
  readonly required: readonly string[];
  readonly properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

export interface PiAiToolMetadata {
  readonly name: PiAiAllowedToolName;
  readonly description: string;
  readonly inputSchema: PiAiToolSchema;
  readonly outputSchema: PiAiToolSchema;
  readonly readOnly: true;
  readonly sideEffects: readonly [];
}

export interface SourceRecordResolver {
  getById(id: UUID): Promise<SourceRecord | null> | SourceRecord | null;
}

export interface PiAiToolContext {
  readonly sourceRecords: SourceRecordResolver;
}

export interface SourceRecordReference {
  readonly id: UUID;
  readonly sourceType: SourceRecordType;
  readonly version: number;
  readonly contentHash?: string;
  readonly capturedAt: string;
  readonly accessLimitations: readonly string[];
  readonly redactionStatus: SourceRecord['redactionStatus'];
}

export interface CopyDraftProposal {
  readonly kind: 'copy_draft_proposal';
  readonly draft: Readonly<Record<string, unknown>>;
  readonly sourceRecordIds: readonly UUID[];
}

export interface ReviewTextClassification {
  readonly kind: 'review_text_classification';
  readonly text: string;
  readonly classification: string;
  readonly summary?: string;
  readonly sourceRecordIds: readonly UUID[];
}

export interface RecommendationProposal {
  readonly text: string;
  readonly metricType?: string;
  readonly metricValue?: string;
  readonly triggerRule?: string;
  readonly contentAnchor: string;
}

export interface RecommendationsProposal {
  readonly kind: 'recommendations_proposal';
  readonly recommendations: readonly RecommendationProposal[];
  readonly sourceRecordIds: readonly UUID[];
}

export interface CoverVisualProposal {
  readonly kind: 'cover_visual_proposal';
  readonly visualBrief: Readonly<Record<string, unknown>>;
  readonly noText: true;
  readonly sourceRecordIds: readonly UUID[];
}

export type PiAiToolOutput =
  | ReturnType<typeof makeSourceRulesOutput>
  | ReturnType<typeof makeBriefSourcesOutput>
  | CopyDraftProposal
  | ReviewTextClassification
  | RecommendationsProposal
  | CoverVisualProposal;

export interface PiAiToolCall {
  readonly name: string;
  readonly input: unknown;
}

export interface PiAiToolExecution {
  readonly name: PiAiAllowedToolName;
  readonly output: PiAiToolOutput;
  readonly metadata: {
    readonly readOnly: true;
    readonly sourceRecordIds: readonly UUID[];
  };
}

export interface PiAiToolRegistry {
  readonly listMetadata: () => readonly PiAiToolMetadata[];
  readonly getMetadata: (name: string) => PiAiToolMetadata | null;
  readonly execute: (call: PiAiToolCall) => Promise<PiAiToolExecution>;
}

const sourceRecordIdsSchema: Readonly<Record<string, unknown>> = {
  type: 'array',
  minItems: 1,
  maxItems: MAX_SOURCE_RECORDS,
  items: { type: 'string', minLength: 1, maxLength: 128 },
};

const sourceRulesInputSchema = schema(
  ['sourceRecordIds'],
  { sourceRecordIds: sourceRecordIdsSchema, version: { type: 'string', minLength: 1, maxLength: 32 } },
);
const sourceRulesOutputSchema = schema(
  ['version', 'hash', 'ruleIds', 'rules', 'sourceRecordIds'],
  {
    version: { type: 'string' },
    hash: { type: 'string' },
    ruleIds: { type: 'array' },
    rules: { type: 'array' },
    sourceRecordIds: sourceRecordIdsSchema,
  },
);
const sourceOnlyInputSchema = schema(['sourceRecordIds'], { sourceRecordIds: sourceRecordIdsSchema });
const briefSourcesOutputSchema = schema(
  ['sources', 'sourceRecordIds'],
  { sources: { type: 'array' }, sourceRecordIds: sourceRecordIdsSchema },
);
const copyDraftInputSchema = schema(
  ['sourceRecordIds', 'draft'],
  { sourceRecordIds: sourceRecordIdsSchema, draft: { type: 'object', additionalProperties: false } },
);
const copyDraftOutputSchema = schema(
  ['kind', 'draft', 'sourceRecordIds'],
  {
    kind: { type: 'string', const: 'copy_draft_proposal' },
    draft: { type: 'object' },
    sourceRecordIds: sourceRecordIdsSchema,
  },
);
const reviewTextInputSchema = schema(
  ['sourceRecordIds', 'text'],
  {
    sourceRecordIds: sourceRecordIdsSchema,
    text: { type: 'string', minLength: 1, maxLength: MAX_TEXT_LENGTH },
    classification: { type: 'string', minLength: 1, maxLength: 200 },
    summary: { type: 'string', minLength: 1, maxLength: MAX_TEXT_LENGTH },
  },
);
const reviewTextOutputSchema = schema(
  ['kind', 'text', 'classification', 'sourceRecordIds'],
  {
    kind: { type: 'string', const: 'review_text_classification' },
    text: { type: 'string' },
    classification: { type: 'string' },
    summary: { type: 'string' },
    sourceRecordIds: sourceRecordIdsSchema,
  },
);
const recommendationsInputSchema = schema(
  ['sourceRecordIds', 'recommendations'],
  {
    sourceRecordIds: sourceRecordIdsSchema,
    recommendations: { type: 'array', minItems: 1, maxItems: 32 },
  },
);
const recommendationsOutputSchema = schema(
  ['kind', 'recommendations', 'sourceRecordIds'],
  {
    kind: { type: 'string', const: 'recommendations_proposal' },
    recommendations: { type: 'array' },
    sourceRecordIds: sourceRecordIdsSchema,
  },
);
const coverInputSchema = schema(
  ['sourceRecordIds', 'visualBrief'],
  {
    sourceRecordIds: sourceRecordIdsSchema,
    visualBrief: { type: 'object', additionalProperties: false },
  },
);
const coverOutputSchema = schema(
  ['kind', 'visualBrief', 'noText', 'sourceRecordIds'],
  {
    kind: { type: 'string', const: 'cover_visual_proposal' },
    visualBrief: { type: 'object' },
    noText: { type: 'boolean', const: true },
    sourceRecordIds: sourceRecordIdsSchema,
  },
);

function schema(
  required: readonly string[],
  properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): PiAiToolSchema {
  return Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: Object.freeze([...required]),
    properties: Object.freeze({ ...properties }),
  });
}

const METADATA: readonly PiAiToolMetadata[] = Object.freeze([
  metadata(
    'read_source_rules',
    'Read an immutable packaged Source_Rules snapshot by version.',
    sourceRulesInputSchema,
    sourceRulesOutputSchema,
  ),
  metadata(
    'read_brief_sources',
    'Read safe metadata for approved Content_Brief and supplementary sources.',
    sourceOnlyInputSchema,
    briefSourcesOutputSchema,
  ),
  metadata(
    'propose_copy_draft',
    'Return a structured copy draft proposal for later deterministic validation; never publish or save it.',
    copyDraftInputSchema,
    copyDraftOutputSchema,
  ),
  metadata(
    'classify_review_text',
    'Return a review-text classification candidate for already supplied content only.',
    reviewTextInputSchema,
    reviewTextOutputSchema,
  ),
  metadata(
    'propose_recommendations',
    'Return recommendation candidates with metric/content anchors and source references.',
    recommendationsInputSchema,
    recommendationsOutputSchema,
  ),
  metadata(
    'compose_cover_visual',
    'Return a no-text cover visual proposal; title, logo, publishing, and persistence remain outside the Agent.',
    coverInputSchema,
    coverOutputSchema,
  ),
]);

function metadata(
  name: PiAiAllowedToolName,
  description: string,
  inputSchema: PiAiToolSchema,
  outputSchema: PiAiToolSchema,
): PiAiToolMetadata {
  return Object.freeze({
    name,
    description,
    inputSchema,
    outputSchema,
    readOnly: true,
    sideEffects: Object.freeze([]) as readonly [],
  });
}

function isAllowedToolName(value: string): value is PiAiAllowedToolName {
  return (PI_AI_ALLOWED_TOOL_NAMES as readonly string[]).includes(value);
}

function assertPlainObject(value: unknown, code: PiAiToolErrorCode = 'TOOL_INPUT_INVALID'):
  asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PiAiToolBoundaryError({ code });
  }
}

function assertSafeKeys(value: Record<string, unknown>): void {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_INPUT_KEYS.has(key.toLowerCase())) {
      throw new PiAiToolBoundaryError({ code: 'TOOL_OPERATION_FORBIDDEN' });
    }
  }
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  assertSafeKeys(value);
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    throw new PiAiToolBoundaryError({ code: 'TOOL_INPUT_INVALID' });
  }
}

function readString(value: unknown, maxLength = 512): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new PiAiToolBoundaryError({ code: 'TOOL_INPUT_INVALID' });
  }
  return value;
}

function readSourceIds(value: unknown): UUID[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SOURCE_RECORDS) {
    throw new PiAiToolBoundaryError({ code: 'SOURCE_RECORD_REQUIRED' });
  }
  const ids = value.map((id) => readString(id, 128));
  if (new Set(ids).size !== ids.length) {
    throw new PiAiToolBoundaryError({ code: 'TOOL_INPUT_INVALID' });
  }
  return ids;
}

function assertJsonValue(value: unknown, depth = 0): void {
  if (depth > 8 || value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    throw new PiAiToolBoundaryError({ code: 'TOOL_INPUT_INVALID' });
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new PiAiToolBoundaryError({ code: 'TOOL_INPUT_INVALID' });
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 128) throw new PiAiToolBoundaryError({ code: 'TOOL_INPUT_INVALID' });
    value.forEach((item) => assertJsonValue(item, depth + 1));
    return;
  }
  assertPlainObject(value);
  assertSafeKeys(value);
  if (Object.keys(value).length > MAX_PROPOSAL_KEYS) {
    throw new PiAiToolBoundaryError({ code: 'TOOL_INPUT_INVALID' });
  }
  Object.values(value).forEach((item) => assertJsonValue(item, depth + 1));
}

async function resolveSources(
  context: PiAiToolContext,
  ids: readonly UUID[],
  allowedTypes?: readonly SourceRecordType[],
): Promise<SourceRecord[]> {
  const records: SourceRecord[] = [];
  for (const id of ids) {
    const record = await context.sourceRecords.getById(id);
    if (!record) throw new PiAiToolBoundaryError({ code: 'SOURCE_RECORD_NOT_FOUND' });
    if (allowedTypes && !allowedTypes.includes(record.sourceType)) {
      throw new PiAiToolBoundaryError({ code: 'SOURCE_RECORD_REQUIRED' });
    }
    records.push(record);
  }
  return records;
}

function sourceReference(record: SourceRecord): SourceRecordReference {
  return {
    id: record.id,
    sourceType: record.sourceType,
    version: record.version,
    ...(record.contentHash ? { contentHash: record.contentHash } : {}),
    capturedAt: record.capturedAt.toISOString(),
    accessLimitations: [...record.accessLimitations],
    redactionStatus: record.redactionStatus,
  };
}

function makeSourceRulesOutput(snapshot: ReturnType<typeof read_source_rules>, sourceRecordIds: readonly UUID[]) {
  return {
    version: snapshot.version,
    hash: snapshot.hash,
    ruleIds: [...snapshot.ruleIds],
    rules: snapshot.rules.map((rule) => ({
      id: rule.id,
      order: rule.order,
      sourceText: rule.sourceText,
      normalizedRule: rule.normalizedRule,
      executableChecks: [...rule.executableChecks],
    })),
    sourceRecordIds: [...sourceRecordIds],
  };
}

function makeBriefSourcesOutput(records: readonly SourceRecord[], sourceRecordIds: readonly UUID[]) {
  return { sources: records.map(sourceReference), sourceRecordIds: [...sourceRecordIds] };
}

function validateProposalObject(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  assertPlainObject(value);
  assertExactKeys(value, allowedKeys);
  assertJsonValue(value);
  if (Object.keys(value).length === 0) {
    throw new PiAiToolBoundaryError({ code: 'TOOL_INPUT_INVALID' });
  }
  return value;
}

function validateRecommendations(value: unknown): RecommendationProposal[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    throw new PiAiToolBoundaryError({ code: 'TOOL_INPUT_INVALID' });
  }
  return value.map((item) => {
    assertPlainObject(item);
    assertExactKeys(item, ['text', 'metricType', 'metricValue', 'triggerRule', 'contentAnchor']);
    const text = readString(item.text, MAX_TEXT_LENGTH);
    const contentAnchor = readString(item.contentAnchor, MAX_TEXT_LENGTH);
    const result = {
      text,
      contentAnchor,
      ...(item.metricType === undefined ? {} : { metricType: readString(item.metricType, 128) }),
      ...(item.metricValue === undefined ? {} : { metricValue: readString(item.metricValue, 128) }),
      ...(item.triggerRule === undefined
        ? {}
        : { triggerRule: readString(item.triggerRule, MAX_TEXT_LENGTH) }),
    };
    return result;
  });
}

function validateOutputSourceIds(output: unknown, sourceRecordIds: readonly UUID[]): void {
  assertPlainObject(output, 'TOOL_OUTPUT_INVALID');
  const ids = readSourceIds(output.sourceRecordIds);
  if (ids.length !== sourceRecordIds.length || ids.some((id, index) => id !== sourceRecordIds[index])) {
    throw new PiAiToolBoundaryError({ code: 'TOOL_OUTPUT_INVALID' });
  }
}

async function executeAllowedTool(
  name: PiAiAllowedToolName,
  input: unknown,
  context: PiAiToolContext,
): Promise<PiAiToolOutput> {
  assertPlainObject(input);
  assertSafeKeys(input);

  if (name === 'read_source_rules') {
    assertExactKeys(input, ['sourceRecordIds', 'version']);
    const sourceRecordIds = readSourceIds(input.sourceRecordIds);
    const records = await resolveSources(context, sourceRecordIds, ['SOURCE_RULES']);
    const version = input.version === undefined ? undefined : readString(input.version, 32);
    const output = makeSourceRulesOutput(read_source_rules(version), sourceRecordIds);
    validateOutputSourceIds(output, sourceRecordIds);
    void records;
    return output;
  }

  if (name === 'read_brief_sources') {
    assertExactKeys(input, ['sourceRecordIds']);
    const sourceRecordIds = readSourceIds(input.sourceRecordIds);
    const records = await resolveSources(context, sourceRecordIds, [
      'BRIEF_FIELD',
      'FILE',
      'INSIGHT',
      'MANUAL_INPUT',
      'SOURCE_RULES',
    ]);
    const output = makeBriefSourcesOutput(records, sourceRecordIds);
    validateOutputSourceIds(output, sourceRecordIds);
    return output;
  }

  if (name === 'propose_copy_draft') {
    assertExactKeys(input, ['sourceRecordIds', 'draft']);
    const sourceRecordIds = readSourceIds(input.sourceRecordIds);
    await resolveSources(context, sourceRecordIds);
    const draft = validateProposalObject(input.draft, [
      'targetAudience',
      'targetEmotion',
      'titles',
      'opening',
      'firstThreeLines',
      'painPoint',
      'method',
      'realLimitation',
      'body',
      'bodyPoints',
      'interactionEnding',
      'tags',
      'tagBuckets',
      'appliedRuleIds',
      'needsOperatorConfirmation',
    ]);
    const output: CopyDraftProposal = { kind: 'copy_draft_proposal', draft, sourceRecordIds };
    validateOutputSourceIds(output, sourceRecordIds);
    return output;
  }

  if (name === 'classify_review_text') {
    assertExactKeys(input, ['sourceRecordIds', 'text', 'classification', 'summary']);
    const sourceRecordIds = readSourceIds(input.sourceRecordIds);
    await resolveSources(context, sourceRecordIds, ['OPENCLI_CONTENT', 'MANUAL_INPUT', 'URL']);
    const text = readString(input.text, MAX_TEXT_LENGTH);
    const classification = input.classification === undefined ? 'candidate' : readString(input.classification, 200);
    const output: ReviewTextClassification = {
      kind: 'review_text_classification',
      text,
      classification,
      ...(input.summary === undefined ? {} : { summary: readString(input.summary, MAX_TEXT_LENGTH) }),
      sourceRecordIds,
    };
    validateOutputSourceIds(output, sourceRecordIds);
    return output;
  }

  if (name === 'propose_recommendations') {
    assertExactKeys(input, ['sourceRecordIds', 'recommendations']);
    const sourceRecordIds = readSourceIds(input.sourceRecordIds);
    await resolveSources(context, sourceRecordIds);
    const recommendations = validateRecommendations(input.recommendations);
    const output: RecommendationsProposal = {
      kind: 'recommendations_proposal',
      recommendations,
      sourceRecordIds,
    };
    validateOutputSourceIds(output, sourceRecordIds);
    return output;
  }

  assertExactKeys(input, ['sourceRecordIds', 'visualBrief']);
  const sourceRecordIds = readSourceIds(input.sourceRecordIds);
  await resolveSources(context, sourceRecordIds, ['BRIEF_FIELD', 'FILE', 'INSIGHT', 'MANUAL_INPUT']);
  const visualBrief = validateProposalObject(input.visualBrief, [
    'topic',
    'style',
    'mood',
    'composition',
    'negativeConstraints',
    'realLimitation',
    'illustration',
  ]);
  const output: CoverVisualProposal = {
    kind: 'cover_visual_proposal',
    visualBrief,
    noText: true,
    sourceRecordIds,
  };
  validateOutputSourceIds(output, sourceRecordIds);
  return output;
}

/**
 * Creates the only tool registry that may be passed to the pi-ai adapter.
 * The registry has no write, network, shell, filesystem, account, auth, or
 * credential capability by construction.
 */
export function createPiAiToolRegistry(context: PiAiToolContext): PiAiToolRegistry {
  if (!context || !context.sourceRecords || typeof context.sourceRecords.getById !== 'function') {
    throw new PiAiToolBoundaryError({ code: 'SOURCE_RECORD_REQUIRED' });
  }

  return {
    listMetadata: () => METADATA,
    getMetadata: (name) => (isAllowedToolName(name) ? METADATA.find((tool) => tool.name === name) ?? null : null),
    execute: async (call) => {
      if (!call || typeof call.name !== 'string' || !isAllowedToolName(call.name)) {
        throw new PiAiToolBoundaryError({ code: 'TOOL_NOT_ALLOWED' });
      }
      try {
        const output = await executeAllowedTool(call.name, call.input, context);
        return {
          name: call.name,
          output,
          metadata: {
            readOnly: true,
            sourceRecordIds: [...(output.sourceRecordIds ?? [])],
          },
        };
      } catch (error) {
        if (error instanceof PiAiToolBoundaryError) throw error;
        // Repository/provider failures never cross the Agent boundary.
        throw new PiAiToolBoundaryError({
          code: 'TOOL_INPUT_INVALID',
          toolName: call.name,
        });
      }
    },
  };
}

/** Metadata is safe to pass into a pi-ai request; execution stays server-only. */
export const PI_AI_TOOL_ALLOWLIST: readonly PiAiToolMetadata[] = METADATA;

export function getPiAiToolMetadata(): readonly PiAiToolMetadata[] {
  return METADATA;
}

/** Alias used by adapter composition code. */
export const createPiAiToolAllowlist = createPiAiToolRegistry;

/** A guard for adapters that receive a model-request tool name. */
export function assertPiAiToolAllowed(name: string): asserts name is PiAiAllowedToolName {
  if (!isAllowedToolName(name)) {
    throw new PiAiToolBoundaryError({ code: 'TOOL_NOT_ALLOWED' });
  }
}
