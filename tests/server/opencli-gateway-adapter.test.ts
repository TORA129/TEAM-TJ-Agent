import { describe, expect, it } from 'vitest';

import { HttpOpenCliGatewayAdapter } from '../../server/review/opencli-gateway';

const input = {
  reviewId: 'review-1',
  authorizationId: 'authorization-1',
  exactNoteUrl: 'https://www.xiaohongshu.com/explore/note-1',
} as const;

const config = {
  openCli: {
    gatewayUrl: 'https://gateway.example.test/fetch',
    gatewayToken: 'server-only-token',
    timeoutMs: 1000,
  },
} as const;

describe('HttpOpenCliGatewayAdapter', () => {
  it('sends only server-derived request context and normalizes accessible content', async () => {
    let requestInit: RequestInit | undefined;
    const adapter = new HttpOpenCliGatewayAdapter(config, async (_url, init) => {
      requestInit = init;
      return new Response(
        JSON.stringify({
          status: 'ok',
          content: { contentType: 'note', title: '标题', body: '正文' },
        }),
        { status: 200 },
      );
    });

    await expect(adapter.fetch(input)).resolves.toMatchObject({
      kind: 'success',
      content: {
        reviewId: input.reviewId,
        authorizationId: input.authorizationId,
        title: '标题',
        body: '正文',
      },
    });
    expect(JSON.parse(String(requestInit?.body))).toEqual(input);
    expect(String(requestInit?.body)).not.toMatch(/cookie|Bearer|server-only-token/i);
    expect(requestInit?.headers).toMatchObject({ authorization: 'Bearer server-only-token' });
  });

  it('maps gateway failure categories without returning raw gateway data', async () => {
    const adapter = new HttpOpenCliGatewayAdapter(
      config,
      async () =>
        new Response(
          JSON.stringify({ status: 'error', error: 'PLATFORM_BLOCKED', secret: 'must-not-leak' }),
          { status: 200 },
        ),
    );
    await expect(adapter.fetch(input)).resolves.toEqual({
      kind: 'failure',
      code: 'PLATFORM_BLOCKED',
    });
  });

  it('maps aborted requests to timeout', async () => {
    const adapter = new HttpOpenCliGatewayAdapter(
      { openCli: { ...config.openCli, timeoutMs: 1 } },
      async (_url, init) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
        return new Response('{}');
      },
    );
    await expect(adapter.fetch(input)).resolves.toEqual({ kind: 'failure', code: 'TIMEOUT' });
  });
});
