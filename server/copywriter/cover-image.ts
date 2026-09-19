import 'server-only';

import type { ServerConfiguration } from '@/server/config';
import {
  OpenRouterModelCatalog,
  type ModelCapabilityRequirements,
} from '@/server/openrouter-model-catalog';
import { PublicApplicationError } from '@/server/public-errors';

export const COVER_IMAGE_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const COVER_IMAGE_PROMPT_CONSTRAINTS = [
  'Generate only a clean 3:4 portrait visual background for a Xiaohongshu cover.',
  'No text, no letters, no words, no numbers, no typography, no logo, no watermark, no symbols that resemble writing.',
  'Leave generous uncluttered negative space in the central area for server-side title composition.',
  'Place a small subject-related illustration or visual accent in the bottom-right corner.',
  'Use an authentic, approachable, real-person editorial feel; avoid plastic-looking AI surfaces, glossy 3D renders, and over-stylized stock imagery.',
].join(' ');

export type CoverVisualInput = Readonly<{
  readonly subject: string;
  readonly visualMood?: string;
  readonly realLimitation?: string;
  readonly style?: string;
}>;

export type CoverVisualResult = Readonly<{
  readonly bytes: Uint8Array;
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly modelId: string;
  readonly catalogVersion: string;
  readonly prompt: string;
}>;

export interface CoverImageAdapter {
  generate(input: CoverVisualInput): Promise<CoverVisualResult>;
}

export interface CoverImageAdapterOptions {
  readonly catalog: OpenRouterModelCatalog;
  readonly request?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_PROMPT_CHARS = 4_000;
const IMAGE_REQUIREMENTS: ModelCapabilityRequirements = { imageOutput: true };
const ALLOWED_MIME_TYPES = new Set<CoverVisualResult['mimeType']>([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

function asText(value: string | undefined, field: string, max = 1_000): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > max) {
    throw new PublicApplicationError({
      code: 'COVER_UNAVAILABLE',
      fieldErrors: { [field]: ['Cover visual input is too long.'] },
    });
  }
  return normalized;
}

function buildPrompt(input: CoverVisualInput): string {
  const subject = asText(input.subject, 'subject');
  if (!subject) {
    throw new PublicApplicationError({
      code: 'COVER_UNAVAILABLE',
      fieldErrors: { subject: ['A cover subject is required.'] },
    });
  }
  const mood = asText(input.visualMood, 'visualMood');
  const style = asText(input.style, 'style');
  const limitation = asText(input.realLimitation, 'realLimitation');
  const details = [
    `Subject: ${subject}`,
    mood ? `Mood: ${mood}` : undefined,
    style ? `Style: ${style}` : undefined,
    limitation
      ? `Keep this limitation visually consistent without rendering it as text: ${limitation}`
      : undefined,
  ].filter((value): value is string => Boolean(value));
  const prompt = `${COVER_IMAGE_PROMPT_CONSTRAINTS} ${details.join('. ')}.`;
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new PublicApplicationError({ code: 'COVER_UNAVAILABLE' });
  }
  return prompt;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function decodeDataUrl(value: string):
  | { readonly mimeType: CoverVisualResult['mimeType']; readonly bytes: Uint8Array }
  | undefined {
  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return undefined;
  const mimeType = match[1].toLowerCase() as CoverVisualResult['mimeType'];
  if (!ALLOWED_MIME_TYPES.has(mimeType)) return undefined;
  return { mimeType, bytes: Buffer.from(match[2], 'base64') };
}

function extractImage(value: unknown):
  | { readonly mimeType: CoverVisualResult['mimeType']; readonly bytes: Uint8Array }
  | undefined {
  if (!isRecord(value) || !Array.isArray(value.choices)) return undefined;
  for (const choice of value.choices) {
    if (!isRecord(choice) || !isRecord(choice.message)) continue;
    const message = choice.message;
    const candidates: unknown[] = [];
    if (Array.isArray(message.images)) candidates.push(...message.images);
    if (Array.isArray(message.content)) candidates.push(...message.content);
    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        const decoded = decodeDataUrl(candidate);
        if (decoded) return decoded;
      }
      if (!isRecord(candidate)) continue;
      const imageUrl = candidate.image_url;
      const url =
        typeof imageUrl === 'string'
          ? imageUrl
          : isRecord(imageUrl) && typeof imageUrl.url === 'string'
            ? imageUrl.url
            : undefined;
      if (url) {
        const decoded = decodeDataUrl(url);
        if (decoded) return decoded;
      }
      if (typeof candidate.data === 'string') {
        const decoded = decodeDataUrl(candidate.data);
        if (decoded) return decoded;
      }
    }
  }
  return undefined;
}

function assertImageBytes(
  bytes: Uint8Array,
  mimeType: CoverVisualResult['mimeType'],
  maxBytes: number,
): void {
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
    throw new PublicApplicationError({ code: 'COVER_UNAVAILABLE' });
  }
  const validSignature =
    mimeType === 'image/png'
      ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      : mimeType === 'image/jpeg'
        ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
          String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (!validSignature) throw new PublicApplicationError({ code: 'COVER_UNAVAILABLE' });
}

export class OpenRouterCoverImageAdapter implements CoverImageAdapter {
  private readonly request: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(
    private readonly config: Pick<ServerConfiguration, 'openRouter'>,
    private readonly options: CoverImageAdapterOptions,
  ) {
    this.request = options.request ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? COVER_IMAGE_MAX_RESPONSE_BYTES;
    if (
      !Number.isSafeInteger(this.timeoutMs) ||
      this.timeoutMs < 1 ||
      !Number.isSafeInteger(this.maxResponseBytes) ||
      this.maxResponseBytes < 1
    ) {
      throw new Error('Invalid cover image adapter limits.');
    }
  }

  async generate(input: CoverVisualInput): Promise<CoverVisualResult> {
    const prompt = buildPrompt(input);
    const selection = this.options.catalog.select(IMAGE_REQUIREMENTS, this.config.openRouter.model);
    if (selection.status !== 'selected' || !selection.selectedModelId || !selection.catalogVersion) {
      throw new PublicApplicationError({ code: 'COVER_UNAVAILABLE' });
    }
    if (!this.config.openRouter.apiKey) {
      throw new PublicApplicationError({ code: 'COVER_UNAVAILABLE' });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.request(`${this.config.openRouter.baseUrl}/chat/completions`, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.openRouter.apiKey}`,
        },
        body: JSON.stringify({
          model: selection.selectedModelId,
          messages: [{ role: 'user', content: prompt }],
          modalities: ['text', 'image'],
          image_config: { aspect_ratio: '3:4' },
        }),
      });
      const contentLength = response.headers.get('content-length');
      if (
        contentLength !== null &&
        (!/^\d+$/.test(contentLength) || Number(contentLength) > this.maxResponseBytes)
      ) {
        throw new PublicApplicationError({ code: 'COVER_UNAVAILABLE' });
      }
      if (!response.ok) throw new PublicApplicationError({ code: 'COVER_UNAVAILABLE' });
      if (!response.body) throw new PublicApplicationError({ code: 'COVER_UNAVAILABLE' });
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          totalBytes += next.value.byteLength;
          if (totalBytes > this.maxResponseBytes) {
            throw new PublicApplicationError({ code: 'COVER_UNAVAILABLE' });
          }
          chunks.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
      const payload = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
      const image = extractImage(payload);
      const modelId = isRecord(payload) && typeof payload.model === 'string' ? payload.model : undefined;
      if (!image || !modelId) throw new PublicApplicationError({ code: 'COVER_UNAVAILABLE' });
      const actual = this.options.catalog.validateActual(modelId, IMAGE_REQUIREMENTS);
      if (actual.status !== 'selected') throw new PublicApplicationError({ code: 'COVER_UNAVAILABLE' });
      assertImageBytes(image.bytes, image.mimeType, this.maxResponseBytes);
      return {
        ...image,
        modelId,
        catalogVersion: actual.catalogVersion ?? selection.catalogVersion,
        prompt,
      };
    } catch (error) {
      if (error instanceof PublicApplicationError) throw error;
      throw new PublicApplicationError({ code: 'COVER_UNAVAILABLE' });
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createOpenRouterCoverImageAdapter(
  config: Pick<ServerConfiguration, 'openRouter'>,
  options: CoverImageAdapterOptions,
): CoverImageAdapter {
  return new OpenRouterCoverImageAdapter(config, options);
}
