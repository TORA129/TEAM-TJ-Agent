import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  redactModelMessages,
  redactPublicText,
  redactSensitiveValue,
  safeJsonStringify,
  toSafeInfrastructureError,
} from '../../domain/security/redaction';
import { createStructuredLogger, toAllowlistedLogFields } from '../../server/security/logger';
import {
  toSafeApiDTO,
  toSafeMarkdownExport,
  toSafeSourceRecordSummary,
} from '../../server/security/safe-dtos';
import type { SourceRecord } from '../../domain/persistence/models';
import { AuditEventService, SourceRecordService } from '../../domain/persistence/services';
import type { AuditEventRepository, SourceRecordRepository } from '../../domain/persistence/repositories';

const secret = 'super-secret-value';

function serialized(value: unknown): string {
  return JSON.stringify(value);
}

describe('credential redaction and safe observation boundaries', () => {
  it('recursively removes credential keys, secret-like values, paths, connections and stacks', () => {
    const input = {
      safe: 'visible',
      nested: {
        headers: {
          Authorization: `Bearer ${secret}`,
          'x-request-id': 'request-1',
        },
        env: { OPENROUTER_API_KEY: secret },
        databaseUrl: 'postgresql://db-user:db-password@db.internal:5432/team_tj',
        file: 'C:\\Users\\huang\\Desktop\\TEAMTJ\\private.txt',
        stack: `Error: ${secret}\n    at C:\\workspace\\server\\adapter.ts:10:2`,
      },
      values: [`token=${secret}`, 'safe value'],
    };

    const redacted = redactSensitiveValue(input);
    const output = serialized(redacted);

    expect(redacted).toMatchObject({
      safe: 'visible',
      nested: {
        headers: { Authorization: '[redacted]', 'x-request-id': 'request-1' },
        env: { OPENROUTER_API_KEY: '[redacted]' },
        databaseUrl: '[redacted]',
        file: '[internal path]',
        stack: '[internal stack omitted]',
      },
    });
    expect(output).not.toContain(secret);
    expect(output).not.toContain('postgresql://');
    expect(output).not.toContain('C:\\Users\\huang');
    expect(output).not.toContain('workspace');
  });

  it('sanitizes model messages and serializes model output only after redaction', () => {
    const messages = redactModelMessages([
      {
        role: 'user',
        content: `Authorization: Bearer ${secret}`,
        metadata: { apiKey: secret },
      },
    ]);
    expect(messages[0]).toMatchObject({
      role: 'user',
      content: '[redacted]',
      metadata: { apiKey: '[redacted]' },
    });

    const output = safeJsonStringify({ answer: secret, headers: { cookie: secret } });
    expect(output).not.toContain(secret);
    expect(redactPublicText('redis://user:password@internal:6379/0')).toBe(
      '[redacted connection string]',
    );
  });

  it('keeps only allowlisted operational fields in structured logs', () => {
    const safeFields = toAllowlistedLogFields({
      status: 'FAILED',
      providerId: 'openrouter',
      modelId: 'qwen/test:free',
      toolId: 'opencli',
      jobId: 'job-1',
      traceId: 'trace-1',
      error: Object.assign(new Error(`provider leaked ${secret}`), {
        code: 'MODEL_NOT_AVAILABLE',
        stack: `at C:\\workspace\\server.ts:1:1`,
      }),
      sourceRecordId: 'source-1',
      request: 'must not be logged',
      headers: { authorization: secret },
    });

    expect(safeFields).toEqual({
      status: 'FAILED',
      provider: 'openrouter',
      model: 'qwen/test:free',
      tool: 'opencli',
      job: 'job-1',
      trace: 'trace-1',
      error: 'MODEL_NOT_AVAILABLE',
      source: 'source-1',
    });

    const lines: string[] = [];
    const logger = createStructuredLogger((_level, line) => lines.push(line));
    logger.error({ ...safeFields, arbitrary: secret });
    expect(Object.keys(JSON.parse(lines[0]!))).toEqual([
      'status',
      'provider',
      'model',
      'tool',
      'job',
      'trace',
      'error',
      'source',
    ]);
    expect(lines[0]).not.toContain(secret);
    expect(lines[0]).not.toContain('arbitrary');
  });

  it('creates safe SourceRecord, API, infrastructure-error and Markdown outputs', () => {
    const record = {
      id: 'source-1',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      createdBy: 'SYSTEM' as const,
      sourceType: 'MODEL_OUTPUT' as const,
      sourceRef: `postgresql://user:${secret}@db.internal/team_tj`,
      version: 1,
      capturedAt: new Date('2025-01-01T00:00:00.000Z'),
      parentSourceRecordIds: ['parent-1'],
      accessLimitations: [`Cookie: ${secret}`, 'manual fallback'],
      redactionStatus: 'REDACTED' as const,
    } satisfies SourceRecord;
    const summary = toSafeSourceRecordSummary(record);
    expect(summary.sourceRef).toBe('[redacted connection string]');
    expect(summary.accessLimitations[0]).toBe('[redacted]');

    const dto = toSafeApiDTO({ source: summary, error: new Error(secret), cookie: secret });
    const dtoText = serialized(dto);
    expect(dtoText).not.toContain(secret);
    expect(dtoText).not.toContain('stack');

    const markdown = toSafeMarkdownExport(
      `# Review\nAuthorization: Bearer ${secret}\n\n at C:\\workspace\\server.ts:1:1`,
    );
    expect(markdown).not.toContain(secret);
    expect(markdown).not.toContain('workspace');

    const infrastructureError = toSafeInfrastructureError(
      Object.assign(new Error(`db failed ${secret}`), { code: 'DB_UNAVAILABLE' }),
      'Storage unavailable',
    );
    expect(infrastructureError.message).not.toContain(secret);
    expect(JSON.stringify(infrastructureError)).not.toContain(secret);
  });

  it('sanitizes SourceRecord and AuditEvent data before repository persistence', async () => {
    let sourceInput: Record<string, unknown> | undefined;
    const sourceRepository = {
      async create(input: Record<string, unknown>) {
        sourceInput = input;
        return {
          ...input,
          id: 'source-1',
          createdAt: new Date(),
          createdBy: 'SYSTEM',
        } as SourceRecord;
      },
      async getById() {
        return null;
      },
      async listForEntity() {
        return { items: [] };
      },
      async link() {},
      async linkMany() {},
      async listLinks() {
        return [];
      },
    } as unknown as SourceRecordRepository;
    const sourceService = new SourceRecordService(sourceRepository);
    await sourceService.create({
      sourceType: 'MANUAL_INPUT',
      sourceRef: `Cookie: ${secret}`,
      version: 1,
      capturedAt: new Date(),
      parentSourceRecordIds: [],
      accessLimitations: [`Authorization: Bearer ${secret}`],
      redactionStatus: 'REDACTED',
    });
    expect(JSON.stringify(sourceInput)).not.toContain(secret);

    let auditInput: Record<string, unknown> | undefined;
    const auditRepository = {
      async append(input: Record<string, unknown>) {
        auditInput = input;
        return {
          ...input,
          id: 'audit-1',
          createdAt: new Date(),
          createdBy: 'SYSTEM',
        };
      },
      async getByEntity() {
        return { items: [] };
      },
      async getByTraceId() {
        return { items: [] };
      },
    } as unknown as AuditEventRepository;
    await new AuditEventService(auditRepository).append({
      actorType: 'SYSTEM',
      action: 'EXPORT',
      entityType: 'ReviewResult',
      entityId: 'entity-1',
      reason: `db failed token=${secret}`,
      resultStatus: 'FAILED',
      traceId: 'trace-1',
    });
    expect(JSON.stringify(auditInput)).not.toContain(secret);
  });

  it('does not serialize arbitrary errors or write direct console logs in server boundaries', () => {
    const roots = ['server', 'adapters', 'domain', 'app'];
    const forbidden = /JSON\.stringify\((?:error|exception)|console\.(?:log|error|warn|info|debug)/;
    const files: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = resolve(directory, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (full.endsWith('.ts') || full.endsWith('.tsx')) files.push(full);
      }
    };
    for (const root of roots) walk(resolve(process.cwd(), root));

    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(forbidden);
    }
  });
});
