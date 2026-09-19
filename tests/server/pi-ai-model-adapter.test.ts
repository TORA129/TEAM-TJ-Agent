import { describe, expect, it } from 'vitest';

import type { AuditEventRepository } from '../../domain/persistence/repositories';
import {
  createModelAuditSink,
  PiAiModelAdapter,
  type PiAiRequest,
  type PiAiRuntime,
} from '../../server/pi-ai-model-adapter';
import { PublicModelError } from '../../server/model-errors';

const config = {
  provider: 'openrouter',
  model: 'openrouter/free',
  baseUrl: 'https://openrouter.ai/api/v1',
  hasCredential: true,
} as const;

function input(requestId = 'request-1') {
  return {
    jobId: 'job-1',
    entityId: 'entity-1',
    traceId: 'trace-1',
    requestId,
    messages: [{ role: 'user' as const, content: '请返回 JSON。' }],
    output: {
      name: 'copy-draft',
      schema: { type: 'object' },
      parse(value: unknown) {
        if (!value || typeof value !== 'object' || !('answer' in value)) {
          throw new Error('invalid schema');
        }
        return value as { answer: string };
      },
    },
  };
}

class StubRuntime implements PiAiRuntime {
  readonly requests: PiAiRequest[] = [];
  response: { text: string; modelId?: string } = { text: '{"answer":"ok"}', modelId: 'meta-llama/test:free' };

  async generate(request: PiAiRequest) {
    this.requests.push(request);
    return this.response;
  }
}

describe('PiAiModelAdapter', () => {
  it('uses the OpenRouter free route, parses structured output, and records safe metadata', async () => {
    const runtime = new StubRuntime();
    const audits: unknown[] = [];
    const adapter = new PiAiModelAdapter({
      config,
      runtime,
      audit: {
        record: (event) => {
          audits.push(event);
        },
      },
    });

    const result = await adapter.generateStructured(input());

    expect(result.value).toEqual({ answer: 'ok' });
    expect(result.metadata).toMatchObject({
      providerId: 'openrouter',
      modelId: 'meta-llama/test:free',
      requestId: 'request-1',
    });
    expect(runtime.requests[0]).toMatchObject({
      provider: 'openrouter',
      model: 'openrouter/free',
      responseFormat: { name: 'copy-draft' },
    });
    expect(JSON.stringify(audits)).toContain('job-1');
    expect(JSON.stringify(audits)).toContain('request-1');
    expect(JSON.stringify(audits)).not.toContain('api/v1');
  });

  it('maps invalid or empty structured output to a public manual-edit error', async () => {
    const runtime = new StubRuntime();
    runtime.response = { text: '' };
    const adapter = new PiAiModelAdapter({ config, runtime });

    await expect(adapter.generateStructured(input())).rejects.toMatchObject({
      code: 'MODEL_OUTPUT_INVALID',
      action: 'EDIT_MANUALLY',
      retryable: false,
      message: expect.not.stringContaining('api'),
    });
  });

  it('supports streaming deltas and emits a validated final result without network access', async () => {
    const runtime: PiAiRuntime = {
      async generate() {
        throw new Error('generate should not be called');
      },
      async *stream(request) {
        expect(request.provider).toBe('openrouter');
        yield { type: 'text_delta', delta: '{"answer"' };
        yield { type: 'text_delta', delta: ':"streamed"}' };
        yield { type: 'done', modelId: 'qwen/test:free' };
      },
    };
    const adapter = new PiAiModelAdapter({ config, runtime });
    const events = [] as Array<{ type: string; [key: string]: unknown }>;

    for await (const event of adapter.streamStructured(input('stream-request'))) {
      events.push(event as { type: string; [key: string]: unknown });
    }

    expect(events.map((event) => event.type)).toEqual([
      'text_delta',
      'text_delta',
      'structured',
      'done',
    ]);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      result: { value: { answer: 'streamed' }, metadata: { modelId: 'qwen/test:free' } },
    });
  });

  it('enforces free model configuration and never exposes a credential-like value', () => {
    expect(
      () =>
        new PiAiModelAdapter({
          config: { ...config, model: 'openai/gpt-4o', hasCredential: true },
          runtime: new StubRuntime(),
        }),
    ).toThrowError(PublicModelError);

    try {
      new PiAiModelAdapter({
        config: { ...config, model: 'openai/gpt-4o', hasCredential: true },
        runtime: new StubRuntime(),
      });
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain('openai/gpt-4o');
      expect(JSON.stringify(error)).not.toContain('secret');
    }
  });

  it('maps rate limits and timeouts while preserving request IDs', async () => {
    const rateLimitedRuntime: PiAiRuntime = {
      async generate() {
        throw Object.assign(new Error('provider failure'), { status: 429 });
      },
    };
    const rateLimitedAdapter = new PiAiModelAdapter({
      config,
      runtime: rateLimitedRuntime,
    });

    await expect(
      rateLimitedAdapter.generateStructured(input('rate-request')),
    ).rejects.toMatchObject({
      code: 'MODEL_RATE_LIMITED',
      requestId: 'rate-request',
    });

    let signal: AbortSignal | undefined;
    const timeoutRuntime: PiAiRuntime = {
      generate(request) {
        signal = request.signal;
        return new Promise(() => undefined);
      },
    };
    const timeoutAdapter = new PiAiModelAdapter({
      config,
      runtime: timeoutRuntime,
      limits: { timeoutMs: 5 },
    });

    await expect(timeoutAdapter.generateStructured(input('timeout-request'))).rejects.toMatchObject(
      {
        code: 'MODEL_NOT_AVAILABLE',
        requestId: 'timeout-request',
        retryable: true,
      },
    );
    expect(signal?.aborted).toBe(true);
  });

  it('maps the existing AuditEventRepository using only redacted fields', async () => {
    const events: Array<Record<string, unknown>> = [];
    const repository = {
      async append(event: Record<string, unknown>) {
        events.push(event);
        return event;
      },
    } as unknown as AuditEventRepository;

    await createModelAuditSink(repository).record({
      action: 'MODEL_GENERATE',
      jobId: 'job-1',
      requestId: 'request-1',
      traceId: 'trace-1',
      entityType: 'MODEL_OUTPUT',
      entityId: 'entity-1',
      resultStatus: 'SUCCEEDED',
      providerId: 'openrouter',
      modelId: 'qwen/test:free',
      durationMs: 12,
    });

    expect(events[0]).toEqual(
      expect.objectContaining({
        actorType: 'MODEL',
        resultStatus: 'SUCCEEDED',
        providerId: 'openrouter',
        modelId: 'qwen/test:free',
        reason: 'jobId=job-1;requestId=request-1',
      }),
    );
    expect(JSON.stringify(events[0])).not.toContain('Authorization');
    expect(JSON.stringify(events[0])).not.toContain('apiKey');
  });
});
