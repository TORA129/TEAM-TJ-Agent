import { describe, expect, it } from 'vitest';

import type { SourceRecord } from '../../domain/persistence/models';
import {
  createPiAiToolRegistry,
  getPiAiToolMetadata,
  PI_AI_ALLOWED_TOOL_NAMES,
  PiAiToolBoundaryError,
} from '../../server/pi-ai-tools';
import { PiAiModelAdapter, type PiAiRequest, type PiAiRuntime } from '../../server/pi-ai-model-adapter';

const sourceTypes = {
  rules: 'rules-1',
  brief: 'brief-1',
  review: 'review-1',
} as const;

function sourceRecord(id: string, sourceType: SourceRecord['sourceType']): SourceRecord {
  return {
    id,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    createdBy: 'SYSTEM',
    sourceType,
    sourceRef: `${sourceType}:${id}`,
    version: 1,
    contentHash: `hash-${id}`,
    capturedAt: new Date('2025-01-01T00:00:00.000Z'),
    parentSourceRecordIds: [],
    accessLimitations: [],
    redactionStatus: 'NOT_REQUIRED',
  };
}

function registry() {
  const records = new Map<string, SourceRecord>([
    [sourceTypes.rules, sourceRecord(sourceTypes.rules, 'SOURCE_RULES')],
    [sourceTypes.brief, sourceRecord(sourceTypes.brief, 'BRIEF_FIELD')],
    [sourceTypes.review, sourceRecord(sourceTypes.review, 'MANUAL_INPUT')],
  ]);
  return createPiAiToolRegistry({
    sourceRecords: { getById: (id) => records.get(id) ?? null },
  });
}

async function expectBoundary(promise: Promise<unknown>, code: PiAiToolBoundaryError['code']) {
  await expect(promise).rejects.toMatchObject({ code });
}

describe('pi-ai Agent tool boundary', () => {
  it('advertises exactly the six read-only tools and no side effects', () => {
    expect(PI_AI_ALLOWED_TOOL_NAMES).toEqual([
      'read_source_rules',
      'read_brief_sources',
      'propose_copy_draft',
      'classify_review_text',
      'propose_recommendations',
      'compose_cover_visual',
    ]);

    const metadata = getPiAiToolMetadata();
    expect(metadata.map((tool) => tool.name)).toEqual(PI_AI_ALLOWED_TOOL_NAMES);
    expect(metadata.every((tool) => tool.readOnly && tool.sideEffects.length === 0)).toBe(true);
    expect(metadata.every((tool) => tool.inputSchema.additionalProperties === false)).toBe(true);
    expect(metadata.every((tool) => tool.outputSchema.additionalProperties === false)).toBe(true);
  });

  it('reads only packaged rules and requires a SOURCE_RULES Source_Record', async () => {
    const result = await registry().execute({
      name: 'read_source_rules',
      input: { sourceRecordIds: [sourceTypes.rules] },
    });

    expect(result.output).toMatchObject({
      version: '1.0.0',
      sourceRecordIds: [sourceTypes.rules],
    });
    expect((result.output as { rules: unknown[] }).rules).toHaveLength(14);

    await expectBoundary(
      registry().execute({
        name: 'read_source_rules',
        input: { sourceRecordIds: [sourceTypes.brief] },
      }),
      'SOURCE_RECORD_REQUIRED',
    );
  });

  it('requires existing Source_Record references for every proposal and returns read-only envelopes', async () => {
    const toolRegistry = registry();
    const draft = await toolRegistry.execute({
      name: 'propose_copy_draft',
      input: {
        sourceRecordIds: [sourceTypes.brief],
        draft: { targetAudience: '运营人员', body: '候选内容' },
      },
    });
    expect(draft.output).toMatchObject({
      kind: 'copy_draft_proposal',
      sourceRecordIds: [sourceTypes.brief],
    });
    expect(draft.metadata).toEqual({ readOnly: true, sourceRecordIds: [sourceTypes.brief] });

    const review = await toolRegistry.execute({
      name: 'classify_review_text',
      input: { sourceRecordIds: [sourceTypes.review], text: '人工提供的笔记文本' },
    });
    expect(review.output).toMatchObject({
      kind: 'review_text_classification',
      classification: 'candidate',
      sourceRecordIds: [sourceTypes.review],
    });

    await expectBoundary(
      toolRegistry.execute({
        name: 'propose_recommendations',
        input: { sourceRecordIds: ['missing'], recommendations: [{ text: '建议', contentAnchor: '首句' }] },
      }),
      'SOURCE_RECORD_NOT_FOUND',
    );
  });

  it('rejects unknown tool names and privileged operation-shaped inputs', async () => {
    const toolRegistry = registry();
    await expectBoundary(
      toolRegistry.execute({ name: 'read_environment', input: { sourceRecordIds: [sourceTypes.brief] } }),
      'TOOL_NOT_ALLOWED',
    );
    await expectBoundary(
      toolRegistry.execute({
        name: 'read_brief_sources',
        input: { sourceRecordIds: [sourceTypes.brief], operation: 'read_environment' },
      }),
      'TOOL_OPERATION_FORBIDDEN',
    );
    await expectBoundary(
      toolRegistry.execute({
        name: 'read_brief_sources',
        input: { sourceRecordIds: [sourceTypes.brief], shell: 'cat .env' },
      }),
      'TOOL_OPERATION_FORBIDDEN',
    );
    await expectBoundary(
      toolRegistry.execute({
        name: 'compose_cover_visual',
        input: {
          sourceRecordIds: [sourceTypes.brief],
          visualBrief: { topic: '主题', publish: true },
        },
      }),
      'TOOL_OPERATION_FORBIDDEN',
    );
    await expectBoundary(
      toolRegistry.execute({
        name: 'propose_recommendations',
        input: {
          sourceRecordIds: [sourceTypes.review],
          recommendations: [{ text: '保存洞察', contentAnchor: '正文', save: true }],
        },
      }),
      'TOOL_OPERATION_FORBIDDEN',
    );
  });

  it('maps resolver failures to safe public errors without exposing the failure value', async () => {
    const unsafeRegistry = createPiAiToolRegistry({
      sourceRecords: {
        getById: () => {
          throw new Error('OPENROUTER_API_KEY=super-secret-value C:\\private\\token');
        },
      },
    });

    const error = await unsafeRegistry
      .execute({
        name: 'read_brief_sources',
        input: { sourceRecordIds: [sourceTypes.brief] },
      })
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(PiAiToolBoundaryError);
    expect((error as PiAiToolBoundaryError).toDTO()).toEqual({
      code: 'TOOL_INPUT_INVALID',
      message: 'The Agent tool input is invalid.',
      action: 'EDIT_TOOL_INPUT',
      retryable: false,
      toolName: 'read_brief_sources',
    });
    expect(JSON.stringify(error)).not.toContain('super-secret-value');
    expect(JSON.stringify(error)).not.toContain('C:\\\\private');
  });

  it('exposes only allowlisted metadata to the model adapter request', async () => {
    const requests: PiAiRequest[] = [];
    const runtime: PiAiRuntime = {
      async generate(request) {
        requests.push(request);
        return { text: '{"ok":true}', modelId: 'test/model:free' };
      },
    };
    const adapter = new PiAiModelAdapter({
      config: {
        provider: 'openrouter',
        model: 'openrouter/free',
        baseUrl: 'https://openrouter.ai/api/v1',
        hasCredential: true,
      },
      runtime,
      toolRegistry: registry(),
    });

    await adapter.generateStructured({
      jobId: 'job-1',
      entityId: 'entity-1',
      messages: [{ role: 'user', content: '生成候选' }],
      output: {
        name: 'test',
        schema: { type: 'object' },
        parse: (value) => value as { ok: boolean },
      },
    });

    expect(requests[0]?.tools?.map((tool) => tool.name)).toEqual(PI_AI_ALLOWED_TOOL_NAMES);
    expect(JSON.stringify(requests[0]?.tools)).not.toContain('shell');
    expect(JSON.stringify(requests[0]?.tools)).not.toContain('credential');
  });
});
