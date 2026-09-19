import { describe, expect, it, vi } from 'vitest';

import {
  createOpenRouterCatalogFetcher,
  createOpenRouterCatalogSnapshot,
  createStaticOpenRouterCatalogSnapshot,
  OpenRouterModelCatalog,
  OpenRouterCatalogRequestError,
  refreshOpenRouterCatalog,
  selectOpenRouterModel,
  type ModelCapabilities,
} from '../../server/openrouter-model-catalog';
import { PiAiModelAdapter, type PiAiRuntime } from '../../server/pi-ai-model-adapter';
import { PublicModelError } from '../../server/model-errors';

const allCapabilities: ModelCapabilities = {
  structuredOutput: true,
  toolCalls: true,
  imageOutput: true,
};

function catalogPayload() {
  return {
    data: [
      {
        id: 'text-tools:free',
        name: 'Text tools',
        pricing: { prompt: '0', completion: '0' },
        supported_parameters: ['response_format', 'tools'],
        architecture: { modality: 'text->text' },
      },
      {
        id: 'image-model:free',
        pricing: { prompt: '0', completion: '0' },
        supported_parameters: ['response_format', 'tools'],
        architecture: { modality: 'text->text+image' },
      },
      {
        id: 'vision-only:free',
        pricing: { prompt: '0', completion: '0' },
        architecture: { modality: 'image->text' },
      },
      {
        id: 'paid-model',
        pricing: { prompt: '0.000001', completion: '0.000001' },
        supported_parameters: ['response_format', 'tools'],
        architecture: { modality: 'text->text+image' },
      },
    ],
  };
}

describe('OpenRouter free model capability catalog', () => {
  it('creates a versioned catalog with only free models and output capabilities', () => {
    const snapshot = createOpenRouterCatalogSnapshot(catalogPayload(), {
      version: 'models-v7',
      fetchedAt: '2025-01-01T00:00:00.000Z',
      dynamicRouteCapabilities: {
        structuredOutput: true,
        toolCalls: true,
        imageOutput: false,
      },
    });

    expect(snapshot).toMatchObject({
      version: 'models-v7',
      fetchedAt: '2025-01-01T00:00:00.000Z',
      source: 'openrouter_models_api',
      status: 'ready',
    });
    expect(snapshot.models.map((model) => model.id)).toEqual([
      'openrouter/free',
      'text-tools:free',
      'image-model:free',
      'vision-only:free',
    ]);
    expect(snapshot.models.find((model) => model.id === 'text-tools:free')?.capabilities).toEqual({
      structuredOutput: true,
      toolCalls: true,
      imageOutput: false,
    });
    expect(snapshot.models.find((model) => model.id === 'image-model:free')?.capabilities).toEqual({
      structuredOutput: true,
      toolCalls: true,
      imageOutput: true,
    });
    expect(snapshot.models.find((model) => model.id === 'vision-only:free')?.capabilities).toEqual({
      structuredOutput: false,
      toolCalls: false,
      imageOutput: false,
    });
  });

  it('selects the dynamic free route only for capabilities it declares', () => {
    const state = {
      status: 'ready' as const,
      snapshot: createOpenRouterCatalogSnapshot(catalogPayload(), {
        version: 'dynamic-v1',
        dynamicRouteCapabilities: {
          structuredOutput: true,
          toolCalls: true,
          imageOutput: false,
        },
      }),
    };

    expect(selectOpenRouterModel(state, { structuredOutput: true, toolCalls: true })).toMatchObject(
      {
        status: 'selected',
        selectedModelId: 'openrouter/free',
        catalogVersion: 'dynamic-v1',
        manualFallback: true,
      },
    );
    expect(selectOpenRouterModel(state, { imageOutput: true })).toMatchObject({
      status: 'capability_insufficient',
      missingCapabilities: ['imageOutput'],
    });
  });

  it('distinguishes unavailable, rate-limited, and capability-insufficient states', () => {
    const snapshot = createOpenRouterCatalogSnapshot(catalogPayload(), { version: 'v1' });

    expect(selectOpenRouterModel(undefined, { structuredOutput: true }).status).toBe(
      'configuration_missing',
    );
    expect(
      selectOpenRouterModel({ status: 'unavailable', snapshot }, { structuredOutput: true }).status,
    ).toBe('unavailable');
    expect(
      selectOpenRouterModel({ status: 'rate_limited', snapshot }, { structuredOutput: true })
        .status,
    ).toBe('rate_limited');
    expect(
      selectOpenRouterModel({ status: 'ready', snapshot }, { imageOutput: true }, 'text-tools:free')
        .status,
    ).toBe('capability_insufficient');
    expect(
      selectOpenRouterModel(
        { status: 'ready', snapshot },
        { structuredOutput: true },
        'missing:free',
      ).status,
    ).toBe('unavailable');
  });

  it('maps catalog refresh failures without exposing provider details or discarding the previous snapshot', async () => {
    const previous = createOpenRouterCatalogSnapshot(catalogPayload(), { version: 'previous' });
    const rateLimited = await refreshOpenRouterCatalog(
      {
        async fetchModels() {
          throw new OpenRouterCatalogRequestError('rate_limited');
        },
      },
      {},
      previous,
    );
    const unavailable = await refreshOpenRouterCatalog(
      {
        async fetchModels() {
          throw new Error('Authorization: Bearer secret');
        },
      },
      {},
      previous,
    );

    expect(rateLimited).toMatchObject({ status: 'rate_limited', snapshot: previous });
    expect(unavailable).toMatchObject({ status: 'unavailable', snapshot: previous });
    expect(JSON.stringify(unavailable)).not.toContain('secret');
  });

  it('uses a controlled fetcher and never requires a real OpenRouter call in tests', async () => {
    const notConfigured = await refreshOpenRouterCatalog(
      createOpenRouterCatalogFetcher({
        apiKey: undefined,
        baseUrl: 'https://openrouter.example.test/api/v1',
      }),
    );
    expect(notConfigured.status).toBe('not_configured');

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(catalogPayload()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const fetcher = createOpenRouterCatalogFetcher({
        apiKey: 'test-secret',
        baseUrl: 'https://openrouter.example.test/api/v1',
      });
      const state = await refreshOpenRouterCatalog(fetcher, {
        version: 'fetched-v1',
      });

      expect(state.status).toBe('ready');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://openrouter.example.test/api/v1/models',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ Authorization: 'Bearer test-secret' }),
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('gates the model adapter before generation and validates the actual returned model', async () => {
    const snapshot = createStaticOpenRouterCatalogSnapshot(
      [
        {
          id: 'text-tools:free',
          free: true,
          dynamic: false,
          source: 'catalog',
          capabilities: allCapabilities,
        },
      ],
      { version: 'adapter-v1' },
    );
    const catalog = new OpenRouterModelCatalog({ status: 'ready', snapshot });
    const runtime: PiAiRuntime = {
      async generate() {
        return { text: '{"answer":"ok"}', modelId: 'text-tools:free' };
      },
    };
    const input = {
      jobId: 'job-1',
      entityId: 'entity-1',
      messages: [{ role: 'user' as const, content: 'return JSON' }],
      output: {
        name: 'test',
        schema: { type: 'object' },
        parse(value: unknown) {
          return value as { answer: string };
        },
      },
    };
    const adapter = new PiAiModelAdapter({
      config: {
        provider: 'openrouter',
        model: 'text-tools:free',
        baseUrl: 'https://openrouter.example.test/api/v1',
        hasCredential: true,
      },
      runtime,
      catalog,
      modelRequirements: { structuredOutput: true, toolCalls: true },
    });

    await expect(adapter.generateStructured(input)).resolves.toMatchObject({
      value: { answer: 'ok' },
      metadata: { modelId: 'text-tools:free' },
    });

    expect(
      () =>
        new PiAiModelAdapter({
          config: {
            provider: 'openrouter',
            model: 'openrouter/free',
            baseUrl: 'https://openrouter.example.test/api/v1',
            hasCredential: true,
          },
          runtime,
          catalog,
          modelRequirements: { imageOutput: true },
        }),
    ).toThrowError(PublicModelError);
  });
});
