import { describe, expect, it } from 'vitest';

import {
  assertGatewayElapsedTime,
  assertGatewayRedirectCount,
  assertGatewayResponseSize,
  assertSafeGatewayUrl,
  assertSafeRedirect,
  createOpenCliGatewayAdapter,
  isPrivateOrReservedIp,
} from '../../server/review/opencli-gateway';
import { normalizeNoteUrl } from '../../server/review/schema';
import { DEFAULT_NOTE_URL_POLICY, normalizeOfficialNoteUrl } from '../../server/review/url-security';

const valid = 'https://www.xiaohongshu.com/explore/abc123';

describe('official Xiaohongshu URL and gateway security', () => {
  it('accepts only the official HTTPS note path and canonicalizes approved query keys', () => {
    expect(normalizeOfficialNoteUrl(`${valid}?xsec_source=pc&xsec_token=token`)).toMatchObject({
      normalized: `${valid}?xsec_source=pc&xsec_token=token`,
    });
    expect(normalizeNoteUrl(valid).normalized).toBe(valid);
  });

  it.each([
    'http://www.xiaohongshu.com/explore/abc123',
    'https://xiaohongshu.com/explore/abc123',
    'https://www.xiaohongshu.com.evil.test/explore/abc123',
    'https://user:pass@www.xiaohongshu.com/explore/abc123',
    'https://www.xiaohongshu.com:443/explore/abc123',
    'https://www.xiaohongshu.com/explore/abc123?redirect=https://127.0.0.1',
    'https://www.xiaohongshu.com/explore/abc123#fragment',
    'https://www.xiaohongshu.com/explore/../admin',
  ])('rejects unsafe or non-allowlisted URL %s', (url) => {
    expect(() => normalizeOfficialNoteUrl(url)).toThrow();
  });

  it('rejects private, loopback, link-local, and reserved gateway resolutions', async () => {
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('10.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('169.254.1.1')).toBe(true);
    expect(isPrivateOrReservedIp('::1')).toBe(true);
    await expect(
      assertSafeGatewayUrl('https://gateway.example.test/fetch', async () => [
        { address: '127.0.0.1', family: 4 },
      ]),
    ).rejects.toThrow();
    await expect(
      assertSafeGatewayUrl('http://gateway.example.test/fetch', async () => [
        { address: '203.0.113.10', family: 4 },
      ]),
    ).rejects.toThrow();
  });
  it('rejects every redirect, including a same-host path change', () => {
    const note = normalizeOfficialNoteUrl(valid);
    expect(() => assertSafeRedirect(valid, note)).not.toThrow();
    expect(() => assertSafeRedirect('https://www.xiaohongshu.com/explore/other', note)).toThrow();
    expect(() => assertSafeRedirect('https://127.0.0.1/admin', note)).toThrow();
  });

  it('enforces response, redirect, and execution limits', () => {
    expect(() => assertGatewayResponseSize(DEFAULT_NOTE_URL_POLICY.maxResponseBytes + 1)).toThrow();
    expect(() => assertGatewayRedirectCount(1)).toThrow();
    expect(() => assertGatewayElapsedTime(DEFAULT_NOTE_URL_POLICY.timeoutMs + 1)).toThrow();
  });

  it('passes only bounded, allowlisted gateway content to callers', async () => {
    const adapter = createOpenCliGatewayAdapter(async (request) => ({
      status: 'SUCCESS',
      responseBytes: 100,
      elapsedMs: 10,
      content: {
        title: '标题',
        body: '正文',
        retrievedAt: new Date(0).toISOString(),
        sourceUrl: request.exactNoteUrl,
      },
    }));
    await expect(adapter({ reviewId: 'review-1', authorizationId: 'auth-1', exactNoteUrl: valid })).resolves.toMatchObject({
      title: '标题',
      sourceUrl: valid,
    });
  });

  it('maps gateway failures without exposing raw gateway data', async () => {
    const adapter = createOpenCliGatewayAdapter(async () => ({
      status: 'PLATFORM_BLOCKED',
      responseBytes: 0,
      elapsedMs: 10,
      content: { secret: 'must-not-leak' },
    }));
    await expect(adapter({ reviewId: 'review-1', authorizationId: 'auth-1', exactNoteUrl: valid })).rejects.toMatchObject({
      code: 'OPENCLI_FORBIDDEN',
    });
  });

  it('rejects unknown content fields and oversized response metadata', async () => {
    const adapter = createOpenCliGatewayAdapter(async () => ({
      status: 'SUCCESS',
      responseBytes: DEFAULT_NOTE_URL_POLICY.maxResponseBytes + 1,
      elapsedMs: 10,
      content: { body: 'safe', credential: 'secret' },
    }));
    await expect(adapter({ reviewId: 'review-1', authorizationId: 'auth-1', exactNoteUrl: valid })).rejects.toThrow();
  });
});
