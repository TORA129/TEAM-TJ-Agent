import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CoverManualCropRequiredError,
  assertComposedCover,
  composeCoverImage,
  createCoverBrief,
  createSolidPng,
  updateCoverBrief,
  COVER_HEIGHT,
  COVER_WIDTH,
} from '../../server/copywriter/cover-composer';

describe('cover composer', () => {
  it('creates an editable brief and composes a real exact-size PNG with title and Team-TJ logo', () => {
    const brief = createCoverBrief({ title: '早餐不踩坑', visualStyle: '真实清爽' });
    const edited = updateCoverBrief(brief, { limitationOrCaveat: '准备时间较长' });
    const result = composeCoverImage(createSolidPng(COVER_WIDTH, COVER_HEIGHT), edited);

    expect(result.mimeType).toBe('image/png');
    expect(result.width).toBe(1080);
    expect(result.height).toBe(1440);
    expect(Array.from(result.bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(result.pixelHash).toBe(createHash('sha256').update(result.bytes).digest('hex'));
    expect(result.bytes).not.toEqual(createSolidPng(COVER_WIDTH, COVER_HEIGHT));
    expect(edited.limitationOrCaveat).toBe('准备时间较长');
    assertComposedCover(result);
  }, 15_000);

  it('rejects wrong ratios through the manual crop/upload path', () => {
    expect(() => composeCoverImage(createSolidPng(1000, 1000), { title: '早餐' , visualStyle: 'clean' })).toThrow(CoverManualCropRequiredError);
    expect(() => assertComposedCover({ bytes: new Uint8Array([1]), width: 1000, height: 1000 })).toThrow(CoverManualCropRequiredError);
  });

  it('rejects titles longer than nine characters', () => {
    expect(() => createCoverBrief({ title: '这是一个超过九个汉字的标题', visualStyle: 'clean' })).toThrow();
  });
});
