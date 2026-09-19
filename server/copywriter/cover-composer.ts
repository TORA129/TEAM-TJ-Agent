import 'server-only';

import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';

import { PublicApplicationError } from '@/server/public-errors';

export const COVER_WIDTH = 1080;
export const COVER_HEIGHT = 1440;
export const COVER_ASPECT_RATIO = '3:4';

export type CoverBriefInput = Readonly<{
  readonly title: string;
  readonly visualStyle: string;
  readonly whitespaceRequirements?: string;
  readonly limitationOrCaveat?: string;
  readonly illustrationDescription?: string;
  readonly logoText?: string;
}>;

export type CoverBrief = Readonly<{
  readonly title: string;
  readonly visualStyle: string;
  readonly whitespaceRequirements: string;
  readonly limitationOrCaveat: string;
  readonly illustrationDescription: string;
  readonly logoText: string;
}>;

export type ComposedCover = Readonly<{
  readonly bytes: Uint8Array;
  readonly mimeType: 'image/png';
  readonly width: 1080;
  readonly height: 1440;
  readonly aspectRatio: '3:4';
  readonly pixelHash: string;
}>;

export class CoverManualCropRequiredError extends PublicApplicationError {
  readonly reason = 'MANUAL_CROP_REQUIRED';

  constructor(message = 'Cover image must be cropped or uploaded as an exact 3:4 image.') {
    super({ code: 'COVER_RATIO_INVALID', fieldErrors: { image: [message] } });
    this.name = 'CoverManualCropRequiredError';
  }
}

function text(value: string | undefined, field: string, fallback = ''): string {
  const normalized = value?.trim() ?? '';
  if (normalized.length > 500) {
    throw new PublicApplicationError({ code: 'COVER_UNAVAILABLE', fieldErrors: { [field]: ['Cover brief text is too long.'] } });
  }
  return normalized || fallback;
}

export function createCoverBrief(input: CoverBriefInput): CoverBrief {
  const title = text(input.title, 'title');
  if (!title || [...title].length > 9) {
    throw new PublicApplicationError({ code: 'COVER_UNAVAILABLE', fieldErrors: { title: ['Cover title must contain 1–9 characters.'] } });
  }
  return Object.freeze({
    title,
    visualStyle: text(input.visualStyle, 'visualStyle', 'clean editorial'),
    whitespaceRequirements: text(input.whitespaceRequirements, 'whitespaceRequirements', 'Keep the central title area clear.'),
    limitationOrCaveat: text(input.limitationOrCaveat, 'limitationOrCaveat'),
    illustrationDescription: text(input.illustrationDescription, 'illustrationDescription', 'A small subject-related hand-drawn accent in the bottom-right.'),
    logoText: text(input.logoText, 'logoText', 'Team-TJ'),
  });
}

export function updateCoverBrief(brief: CoverBrief, patch: Partial<CoverBriefInput>): CoverBrief {
  return createCoverBrief({ ...brief, ...patch });
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBytes, Buffer.from(data)]);
  const crc = crc32(body);
  const result = Buffer.allocUnsafe(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  body.copy(result, 4);
  result.writeUInt32BE(crc, 8 + data.length);
  return result;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readPng(input: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const bytes = Buffer.from(input);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!bytes.subarray(0, 8).equals(signature)) throw new CoverManualCropRequiredError('Only valid PNG backgrounds can be composed server-side; upload a 3:4 replacement for other formats.');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9];
      if (bitDepth !== 8 || colorType !== 6) throw new CoverManualCropRequiredError('PNG background must use 8-bit RGBA pixels.');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (width !== COVER_WIDTH || height !== COVER_HEIGHT) throw new CoverManualCropRequiredError(`Background is ${width}×${height}; expected ${COVER_WIDTH}×${COVER_HEIGHT}.`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rgba = Buffer.alloc(width * height * 4);
  let inputOffset = 0;
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[inputOffset++];
    const row = raw.subarray(inputOffset, inputOffset + stride); inputOffset += stride;
    const current = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? current[x - 4] : 0;
      const up = previous[x] ?? 0;
      const upperLeft = x >= 4 ? previous[x - 4] : 0;
      const value = row[x];
      current[x] = filter === 0 ? value : filter === 1 ? value + left : filter === 2 ? value + up : filter === 3 ? value + Math.floor((left + up) / 2) : value + paeth(left, up, upperLeft);
    }
    current.copy(rgba, y * stride); previous = current;
  }
  return { width, height, rgba };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function writePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba).subarray(y * stride, (y + 1) * stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const FONT: Record<string, string[]> = {
  A: ['01110','10001','10001','11111','10001','10001','10001'], T: ['11111','00100','00100','00100','00100','00100','00100'], E: ['11111','10000','10000','11110','10000','10000','11111'], M: ['10001','11011','10101','10001','10001','10001','10001'], J: ['00111','00010','00010','00010','10010','10010','01100'], '-': ['00000','00000','00000','11111','00000','00000','00000'], ' ': ['00000','00000','00000','00000','00000','00000','00000'],
};
function drawText(rgba: Uint8Array, width: number, value: string, x: number, y: number, scale: number, color: readonly [number, number, number, number]): void {
  let cursor = x;
  for (const char of value.toUpperCase()) {
    const glyph = FONT[char] ?? FONT[' '];
    glyph.forEach((row, rowIndex) => [...row].forEach((pixel, colIndex) => {
      if (pixel !== '1') return;
      for (let dy = 0; dy < scale; dy += 1) for (let dx = 0; dx < scale; dx += 1) {
        const px = cursor + colIndex * scale + dx; const py = y + rowIndex * scale + dy;
        if (px < 0 || py < 0 || px >= width || py >= COVER_HEIGHT) continue;
        const index = (py * width + px) * 4; rgba[index] = color[0]; rgba[index + 1] = color[1]; rgba[index + 2] = color[2]; rgba[index + 3] = color[3];
      }
    }));
    cursor += 6 * scale;
  }
}

export function createSolidPng(width: number, height: number, color: readonly [number, number, number, number] = [245, 247, 250, 255]): Uint8Array {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new Error('PNG dimensions must be positive integers.');
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < rgba.length; index += 4) {
    rgba[index] = color[0]; rgba[index + 1] = color[1]; rgba[index + 2] = color[2]; rgba[index + 3] = color[3];
  }
  return writePng(width, height, rgba);
}

export function composeCoverImage(background: Uint8Array, briefInput: CoverBriefInput): ComposedCover {
  const brief = createCoverBrief(briefInput);
  const decoded = readPng(background);
  const rgba = new Uint8Array(decoded.rgba);
  const titleScale = 18;
  const titleWidth = [...brief.title].length * 6 * titleScale;
  const titleX = Math.max(32, Math.floor((COVER_WIDTH - titleWidth) / 2));
  const titleY = 550;
  drawText(rgba, COVER_WIDTH, brief.title, titleX, titleY, titleScale, [31, 41, 55, 255]);
  drawText(rgba, COVER_WIDTH, brief.logoText, 48, 54, 5, [31, 41, 55, 255]);
  const output = writePng(COVER_WIDTH, COVER_HEIGHT, rgba);
  return { bytes: output, mimeType: 'image/png', width: COVER_WIDTH, height: COVER_HEIGHT, aspectRatio: COVER_ASPECT_RATIO, pixelHash: createHash('sha256').update(output).digest('hex') };
}

export function assertComposedCover(input: { readonly bytes: Uint8Array; readonly width: number; readonly height: number; readonly pixelHash?: string }): void {
  if (input.width !== COVER_WIDTH || input.height !== COVER_HEIGHT || input.width * 4 !== input.height * 3) throw new CoverManualCropRequiredError();
  const actualHash = createHash('sha256').update(input.bytes).digest('hex');
  if (input.pixelHash !== undefined && input.pixelHash !== actualHash) throw new PublicApplicationError({ code: 'COVER_UNAVAILABLE', fieldErrors: { image: ['Cover pixel hash does not match image bytes.'] } });
}
