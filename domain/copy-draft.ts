import type { TagBuckets } from './persistence/models';

export const COPY_DRAFT_TITLE_COUNT = 5 as const;
export const COPY_DRAFT_BODY_POINT_COUNT = 3 as const;
export const COPY_DRAFT_TAG_COUNT = 8 as const;
export const COPY_DRAFT_MAX_TITLE_HAN = 20 as const;
export const COPY_DRAFT_MAX_BODY_HAN = 300 as const;
export const COPY_DRAFT_MIN_BODY_EMOJI = 4 as const;
export const COPY_DRAFT_MAX_BODY_EMOJI = 6 as const;

export const FORBIDDEN_TITLE_TERMS = ['分享', '干货', '必看', '收藏'] as const;
export const FORBIDDEN_INTERACTION_TERMS = ['私信', '点赞'] as const;

export interface CopyDraftStructure {
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
  readonly tagBuckets: TagBuckets;
}

export interface CopyDraftValidationIssue {
  readonly path: string;
  readonly code:
    | 'REQUIRED'
    | 'TYPE'
    | 'COUNT'
    | 'LENGTH'
    | 'EMOJI_COUNT'
    | 'FORMAT'
    | 'FORBIDDEN_TERM';
  readonly message: string;
}

export interface CopyDraftValidationResult {
  readonly valid: boolean;
  readonly issues: readonly CopyDraftValidationIssue[];
  readonly normalized?: CopyDraftStructure;
}

export interface CopyDraftSchemaResult {
  readonly success: boolean;
  readonly issues: readonly CopyDraftValidationIssue[];
  readonly data?: CopyDraftStructure;
}

type UnknownRecord = Record<string, unknown>;

type CopyDraftField = keyof CopyDraftStructure;

const COPY_DRAFT_FIELDS: readonly CopyDraftField[] = [
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
] as const;

const TAG_BUCKET_FIELDS: readonly (keyof TagBuckets)[] = ['broad', 'medium', 'longTail'];
const HAN_PATTERN = /\p{Script=Han}/u;
const EMOJI_PATTERN = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]/u;

export function normalizeCopyDraftText(value: string): string {
  return value.normalize('NFC');
}

export function countHanCharacters(value: string): number {
  return Array.from(normalizeCopyDraftText(value)).filter((character) => HAN_PATTERN.test(character)).length;
}

export function countEmoji(value: string): number {
  const normalized = normalizeCopyDraftText(value);
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(normalized)).filter(({ segment }) => EMOJI_PATTERN.test(segment)).length;
}

export function countBodyHanCharacters(body: string): number {
  return countHanCharacters(body);
}

export function parseCopyDraftSchema(value: unknown): CopyDraftSchemaResult {
  const issues: CopyDraftValidationIssue[] = [];
  if (!isRecord(value)) {
    return {
      success: false,
      issues: [{ path: 'draft', code: 'TYPE', message: 'Copy_Draft must be an object.' }],
    };
  }

  for (const key of Object.keys(value)) {
    if (!COPY_DRAFT_FIELDS.includes(key as CopyDraftField)) {
      issues.push({ path: key, code: 'TYPE', message: 'Field is not supported by the Copy_Draft schema.' });
    }
  }

  const textFields: readonly (keyof Omit<CopyDraftStructure, 'titles' | 'bodyPoints' | 'tags' | 'tagBuckets'>)[] = [
    'targetAudience',
    'targetEmotion',
    'opening',
    'firstThreeLines',
    'painPoint',
    'method',
    'realLimitation',
    'body',
    'interactionEnding',
  ];
  for (const field of textFields) {
    if (typeof value[field] !== 'string') {
      issues.push({ path: field, code: value[field] === undefined ? 'REQUIRED' : 'TYPE', message: 'Field must be a string.' });
    }
  }

  const arrays: readonly (keyof Pick<CopyDraftStructure, 'titles' | 'bodyPoints' | 'tags'>)[] = [
    'titles',
    'bodyPoints',
    'tags',
  ];
  for (const field of arrays) {
    if (!Array.isArray(value[field]) || value[field].some((item) => typeof item !== 'string')) {
      issues.push({ path: field, code: value[field] === undefined ? 'REQUIRED' : 'TYPE', message: 'Field must be an array of strings.' });
    }
  }

  const tagBuckets = value.tagBuckets;
  if (!isRecord(tagBuckets)) {
    issues.push({ path: 'tagBuckets', code: tagBuckets === undefined ? 'REQUIRED' : 'TYPE', message: 'tagBuckets must be an object.' });
  } else {
    for (const field of TAG_BUCKET_FIELDS) {
      if (!Array.isArray(tagBuckets[field]) || tagBuckets[field].some((item) => typeof item !== 'string')) {
        issues.push({ path: `tagBuckets.${field}`, code: 'TYPE', message: 'Tag bucket must be an array of strings.' });
      }
    }
  }

  if (issues.length > 0) return { success: false, issues };

  const draft: CopyDraftStructure = {
    targetAudience: value.targetAudience as string,
    targetEmotion: value.targetEmotion as string,
    titles: value.titles as string[],
    opening: value.opening as string,
    firstThreeLines: value.firstThreeLines as string,
    painPoint: value.painPoint as string,
    method: value.method as string,
    realLimitation: value.realLimitation as string,
    body: value.body as string,
    bodyPoints: value.bodyPoints as string[],
    interactionEnding: value.interactionEnding as string,
    tags: value.tags as string[],
    tagBuckets: tagBuckets as TagBuckets,
  };
  const validation = validateCopyDraftStructure(draft);
  return validation.valid
    ? { success: true, issues: [], data: validation.normalized }
    : { success: false, issues: validation.issues };
}

export function validateCopyDraftStructure(draft: CopyDraftStructure): CopyDraftValidationResult {
  const issues: CopyDraftValidationIssue[] = [];
  const normalized = normalizeStructure(draft);

  for (const field of ['targetAudience', 'targetEmotion', 'opening', 'firstThreeLines', 'painPoint', 'method', 'realLimitation', 'body', 'interactionEnding'] as const) {
    if (!normalized[field].trim()) {
      issues.push({ path: field, code: 'REQUIRED', message: 'Field must not be empty.' });
    }
  }

  checkExactCount(issues, 'titles', normalized.titles, COPY_DRAFT_TITLE_COUNT);
  checkExactCount(issues, 'bodyPoints', normalized.bodyPoints, COPY_DRAFT_BODY_POINT_COUNT);
  checkExactCount(issues, 'tags', normalized.tags, COPY_DRAFT_TAG_COUNT);
  checkExactCount(issues, 'tagBuckets.broad', normalized.tagBuckets.broad, 3);
  checkExactCount(issues, 'tagBuckets.medium', normalized.tagBuckets.medium, 3);
  checkExactCount(issues, 'tagBuckets.longTail', normalized.tagBuckets.longTail, 2);

  normalized.titles.forEach((title, index) => {
    if (!title.trim()) issues.push({ path: `titles.${index}`, code: 'REQUIRED', message: 'Title must not be empty.' });
    if (countHanCharacters(title) > COPY_DRAFT_MAX_TITLE_HAN) {
      issues.push({ path: `titles.${index}`, code: 'LENGTH', message: `Title must contain no more than ${COPY_DRAFT_MAX_TITLE_HAN} Han characters.` });
    }
    for (const term of FORBIDDEN_TITLE_TERMS) {
      if (title.includes(term)) {
        issues.push({ path: `titles.${index}`, code: 'FORBIDDEN_TERM', message: `Title contains forbidden term: ${term}.` });
      }
    }
  });

  if (countBodyHanCharacters(normalized.body) > COPY_DRAFT_MAX_BODY_HAN) {
    issues.push({ path: 'body', code: 'LENGTH', message: `Body must contain no more than ${COPY_DRAFT_MAX_BODY_HAN} Han characters.` });
  }
  const bodyEmojiCount = countEmoji(normalized.body);
  if (bodyEmojiCount < COPY_DRAFT_MIN_BODY_EMOJI || bodyEmojiCount > COPY_DRAFT_MAX_BODY_EMOJI) {
    issues.push({ path: 'body', code: 'EMOJI_COUNT', message: `Body must contain ${COPY_DRAFT_MIN_BODY_EMOJI}–${COPY_DRAFT_MAX_BODY_EMOJI} emoji.` });
  }

  if (looksLikeGreeting(normalized.opening)) {
    issues.push({ path: 'opening', code: 'FORMAT', message: 'Opening must not begin with a greeting.' });
  }
  normalized.bodyPoints.forEach((point, index) => {
    if (!point.trim()) {
      issues.push({ path: `bodyPoints.${index}`, code: 'REQUIRED', message: 'Body point must not be empty.' });
    } else if (!startsWithEmoji(point)) {
      issues.push({ path: `bodyPoints.${index}`, code: 'FORMAT', message: 'Body point must begin with an emoji heading.' });
    }
  });
  for (const term of FORBIDDEN_INTERACTION_TERMS) {
    if (normalized.interactionEnding.includes(term)) {
      issues.push({ path: 'interactionEnding', code: 'FORBIDDEN_TERM', message: `Interaction ending contains forbidden term: ${term}.` });
    }
  }

  const bucketTags = [...normalized.tagBuckets.broad, ...normalized.tagBuckets.medium, ...normalized.tagBuckets.longTail];
  if (bucketTags.length === COPY_DRAFT_TAG_COUNT && normalized.tags.some((tag, index) => tag !== bucketTags[index])) {
    issues.push({ path: 'tags', code: 'FORMAT', message: 'tags must match tagBuckets in broad, medium, longTail order.' });
  }

  return issues.length > 0
    ? { valid: false, issues, normalized }
    : { valid: true, issues: [], normalized };
}

function normalizeStructure(draft: CopyDraftStructure): CopyDraftStructure {
  return {
    targetAudience: normalizeCopyDraftText(draft.targetAudience),
    targetEmotion: normalizeCopyDraftText(draft.targetEmotion),
    titles: draft.titles.map(normalizeCopyDraftText),
    opening: normalizeCopyDraftText(draft.opening),
    firstThreeLines: normalizeCopyDraftText(draft.firstThreeLines),
    painPoint: normalizeCopyDraftText(draft.painPoint),
    method: normalizeCopyDraftText(draft.method),
    realLimitation: normalizeCopyDraftText(draft.realLimitation),
    body: normalizeCopyDraftText(draft.body),
    bodyPoints: draft.bodyPoints.map(normalizeCopyDraftText),
    interactionEnding: normalizeCopyDraftText(draft.interactionEnding),
    tags: draft.tags.map(normalizeCopyDraftText),
    tagBuckets: {
      broad: draft.tagBuckets.broad.map(normalizeCopyDraftText) as unknown as TagBuckets['broad'],
      medium: draft.tagBuckets.medium.map(normalizeCopyDraftText) as unknown as TagBuckets['medium'],
      longTail: draft.tagBuckets.longTail.map(normalizeCopyDraftText) as unknown as TagBuckets['longTail'],
    },
  };
}

function checkExactCount(
  issues: CopyDraftValidationIssue[],
  path: string,
  values: readonly unknown[],
  expected: number,
): void {
  if (values.length !== expected) {
    issues.push({ path, code: 'COUNT', message: `${path} must contain exactly ${expected} items.` });
  }
}

function startsWithEmoji(value: string): boolean {
  const first = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value.trim()))[0];
  return first !== undefined && EMOJI_PATTERN.test(first.segment);
}

function looksLikeGreeting(value: string): boolean {
  return /^(你好|嗨|hello|hi|大家好|姐妹们好|朋友们好)[，。！!、\s]*/iu.test(value.trim());
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
