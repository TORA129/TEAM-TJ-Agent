import { describe, expect, it, vi } from 'vitest';

import {
  createOpenRouterCatalogSnapshot,
  OpenRouterModelCatalog,
} from '../../server/openrouter-model-catalog';
import { OpenRouterCoverImageAdapter } from '../../server/copywriter/cover-image';

const png = 'iVBORw0KGgo=';
const config = {
  openRouter: {
    apiKey: 'server-secret',
    baseUrl: 'https://openrouter.example.test/api/v1',
    model: 'image-model:free',
  },
} as const;

function catalog(imageOutput = true) {
  const capabilities = {
    structuredOutput: true,
    toolCalls: true,
    imageOutput,
  };
  return new OpenRouterModelCatalog({
    status: 'ready',
    snapshot: createOpenRouterCatalogSnapshot(
      {
        data: [
          {
            id: 'image-model:free',
            pricing: { prompt: '0', completion: '0' },
            architecture: { modality: imageOutput ? 'text->text+image' : 'text->text' },
          },
        ],
      },
      { version: 'cover-v1', dynamicRouteCapabilities: capabilities },
    ),
  });
}

describe('OpenRouterCoverImageAdapter', () => {
  it('uses a free image-capable model and requests a no-text 3:4 visual', async () => {
    let request: RequestInit | undefined;
    const adapter = new OpenRouterCoverImageAdapter(
      config,
      {
        catalog: catalog(),
        request: vi.fn(async (_url, init) => {
          request = init;
          return new Response(
            JSON.stringify({
              model: 'image-model:free',
              choices: [{ message: { images: [`data:image/png;base64,${png}`] } }],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }),
      },
    );

    const result = await adapter.generate({
      subject: '新手做早餐',
      visualMood: '真实、清爽',
      realLimitation: '准备时间较长',
    });

    expect(result).toMatchObject({ mimeType: 'image/png', modelId: 'image-model:free', catalogVersion: 'cover-v1' });
    expect(Array.from(result.bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const body = JSON.parse(String(request?.body));
    expect(body.model).toBe('image-model:free');
    expect(body.image_config).toEqual({ aspect_ratio: '3:4' });
    expect(body.messages[0].content).toMatch(/no text|no letters|no words/i);
    expect(body.messages[0].content).toMatch(/negative space|bottom-right/i);
    expect(request?.headers).toMatchObject({ authorization: 'Bearer server-secret' });
  });

  it('maps missing image capability to COVER_UNAVAILABLE without calling OpenRouter', async () => {
    const request = vi.fn();
    const adapter = new OpenRouterCoverImageAdapter(config, { catalog: catalog(false), request });

    await expect(adapter.generate({ subject: '早餐' })).rejects.toMatchObject({
      code: 'COVER_UNAVAILABLE',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('maps timeout, non-image, and oversized responses to manual fallback', async () => {
    const timeoutAdapter = new OpenRouterCoverImageAdapter(config, {
      catalog: catalog(),
      timeoutMs: 1,
      request: async (_url, init) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
        return new Response('{}');
      },
    });
    await expect(timeoutAdapter.generate({ subject: '早餐' })).rejects.toMatchObject({
      code: 'COVER_UNAVAILABLE',
    });

    const invalidAdapter = new OpenRouterCoverImageAdapter(config, {
      catalog: catalog(),
      request: async () =>
        new Response(JSON.stringify({ model: 'image-model:free', choices: [{ message: { content: ['not an image'] } }] }), { status: 200 }),
    });
    await expect(invalidAdapter.generate({ subject: '早餐' })).rejects.toMatchObject({
      code: 'COVER_UNAVAILABLE',
    });

    const oversizedAdapter = new OpenRouterCoverImageAdapter(config, {
      catalog: catalog(),
      maxResponseBytes: 4,
      request: async () =>
        new Response(JSON.stringify({ model: 'image-model:free', choices: [] }), {
          status: 200,
          headers: { 'content-length': '5' },
        }),
    });
    await expect(oversizedAdapter.generate({ subject: '早餐' })).rejects.toMatchObject({
      code: 'COVER_UNAVAILABLE',
    });
  });
});
