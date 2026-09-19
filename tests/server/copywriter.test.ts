import { describe, expect, it } from 'vitest';
import type {
  AuditEvent,
  ContentBriefVersion,
  IdempotencyRecord,
  QuestionSet,
  SourceRecord,
  SourceRecordLink,
  UUID,
  WorkflowSession,
} from '../../domain/persistence/models';
import type {
  AuditEventRepository,
  ContentBriefVersionRepository,
  IdempotencyRecordRepository,
  Page,
  PageRequest,
  PersistenceRepositories,
  QuestionSetRepository,
  SourceRecordRepository,
  VersionConflict,
  WorkflowSessionRepository,
} from '../../domain/persistence/repositories';
import type { TrustedOperatorSession } from '../../server/auth/session';
import { createTrustedSessionResolver } from '../../server/auth/session';
import {
  createCopywriterSessionGetHandler,
  createCopywriterSessionPatchHandler,
  createCopywriterSessionPostHandler,
} from '../../server/copywriter/http';
import { CopywriterService } from '../../server/copywriter/service';

class InMemoryWorkflowRepository implements WorkflowSessionRepository {
  readonly records = new Map<UUID, WorkflowSession>();

  async create(input: Parameters<WorkflowSessionRepository['create']>[0]): Promise<WorkflowSession> {
    const now = new Date();
    const session: WorkflowSession = {
      ...input,
      id: `session-${this.records.size + 1}`,
      createdAt: now,
      updatedAt: now,
      createdBy: 'SYSTEM',
      currentVersion: 0,
    };
    this.records.set(session.id, session);
    return session;
  }

  async getById(id: UUID): Promise<WorkflowSession | null> {
    return this.records.get(id) ?? null;
  }

  async listByOperator(operatorId: UUID, page: PageRequest): Promise<Page<WorkflowSession>> {
    return {
      items: [...this.records.values()]
        .filter((session) => session.operatorId === operatorId)
        .slice(0, page.limit),
    };
  }

  async updateStatus(
    id: UUID,
    input: Parameters<WorkflowSessionRepository['updateStatus']>[1],
  ): Promise<WorkflowSession | VersionConflict> {
    const current = this.records.get(id);
    if (!current) throw new Error('session not found');
    if (current.currentVersion !== input.expectedVersion) {
      return { entityId: id, expectedVersion: input.expectedVersion, actualVersion: current.currentVersion };
    }
    const { expectedVersion: _expectedVersion, ...changes } = input;
    const updated: WorkflowSession = {
      ...current,
      ...changes,
      currentVersion: current.currentVersion + 1,
      updatedAt: new Date(),
    };
    this.records.set(id, updated);
    return updated;
  }

  async archive(): Promise<never> {
    throw new Error('not used');
  }
}

class InMemoryBriefRepository implements ContentBriefVersionRepository {
  readonly records: ContentBriefVersion[] = [];

  async create(
    input: Omit<ContentBriefVersion, 'id' | 'createdAt' | 'createdBy'>,
  ): Promise<ContentBriefVersion> {
    if (this.records.some((record) => record.sessionId === input.sessionId && record.version === input.version)) {
      throw new Error('unique brief version constraint');
    }
    const record: ContentBriefVersion = {
      ...input,
      id: `brief-${this.records.length + 1}`,
      createdAt: new Date(),
      createdBy: 'SYSTEM',
    };
    this.records.push(record);
    return record;
  }

  async getById(id: UUID): Promise<ContentBriefVersion | null> {
    return this.records.find((record) => record.id === id) ?? null;
  }

  async getBySessionVersion(sessionId: UUID, version: number): Promise<ContentBriefVersion | null> {
    return this.records.find((record) => record.sessionId === sessionId && record.version === version) ?? null;
  }

  async getLatestBySession(sessionId: UUID): Promise<ContentBriefVersion | null> {
    return this.records.filter((record) => record.sessionId === sessionId).at(-1) ?? null;
  }

  async listBySession(sessionId: UUID, page: PageRequest): Promise<Page<ContentBriefVersion>> {
    return { items: this.records.filter((record) => record.sessionId === sessionId).slice(0, page.limit) };
  }
}

class InMemorySourceRepository implements SourceRecordRepository {
  readonly records = new Map<UUID, SourceRecord>();
  readonly links: SourceRecordLink[] = [];

  async create(input: Omit<SourceRecord, 'id' | 'createdAt' | 'createdBy'>): Promise<SourceRecord> {
    const record: SourceRecord = {
      ...input,
      id: `source-${this.records.size + 1}`,
      createdAt: new Date(),
      createdBy: 'SYSTEM',
    };
    this.records.set(record.id, record);
    return record;
  }

  async getById(id: UUID): Promise<SourceRecord | null> {
    return this.records.get(id) ?? null;
  }

  async listForEntity(entityType: string, entityId: UUID, page: PageRequest): Promise<Page<SourceRecord>> {
    const linked = new Set(
      this.links
        .filter((link) => link.entityType === entityType && link.entityId === entityId)
        .map((link) => link.sourceRecordId),
    );
    return { items: [...this.records.values()].filter((record) => linked.has(record.id)).slice(0, page.limit) };
  }

  async link(input: SourceRecordLink): Promise<void> {
    if (!this.links.some((link) => JSON.stringify(link) === JSON.stringify(input))) this.links.push(input);
  }

  async linkMany(input: {
    readonly sourceRecordIds: readonly UUID[];
    readonly entityType: string;
    readonly entityId: UUID;
    readonly role: string;
  }): Promise<void> {
    for (const sourceRecordId of input.sourceRecordIds) {
      await this.link({ sourceRecordId, entityType: input.entityType, entityId: input.entityId, role: input.role });
    }
  }

  async listLinks(entityType: string, entityId: UUID): Promise<readonly SourceRecordLink[]> {
    return this.links.filter((link) => link.entityType === entityType && link.entityId === entityId);
  }
}

class InMemoryQuestionSetRepository implements QuestionSetRepository {
  readonly records = new Map<UUID, QuestionSet>();

  async create(input: Omit<QuestionSet, 'id' | 'createdAt' | 'createdBy'>): Promise<QuestionSet> {
    const questionSet: QuestionSet = { ...input, id: `question-set-${this.records.size + 1}`, createdAt: new Date(), createdBy: 'SYSTEM' };
    this.records.set(questionSet.id, questionSet);
    return questionSet;
  }

  async getById(id: UUID): Promise<QuestionSet | null> { return this.records.get(id) ?? null; }

  async getOpenForBrief(sessionId: UUID, briefVersion: number): Promise<QuestionSet | null> {
    return [...this.records.values()].find((item) => item.sessionId === sessionId && item.briefVersion === briefVersion && item.status === 'OPEN') ?? null;
  }

  async answer(id: UUID, input: Parameters<QuestionSetRepository['answer']>[1]): Promise<QuestionSet | VersionConflict> {
    const current = this.records.get(id);
    if (!current) throw new Error('question set not found');
    if (current.version !== input.expectedVersion) return { entityId: id, expectedVersion: input.expectedVersion, actualVersion: current.version };
    const { expectedVersion: _expectedVersion, ...changes } = input;
    const updated: QuestionSet = { ...current, ...changes, version: current.version + 1 };
    this.records.set(id, updated);
    return updated;
  }
}

class InMemoryAuditRepository implements AuditEventRepository {
  readonly events: AuditEvent[] = [];

  async append(input: Omit<AuditEvent, 'id' | 'createdAt' | 'createdBy'>): Promise<AuditEvent> {
    const event: AuditEvent = { ...input, id: `audit-${this.events.length + 1}`, createdAt: new Date(), createdBy: 'SYSTEM' };
    this.events.push(event);
    return event;
  }

  async getByEntity(entityType: string, entityId: UUID, page: PageRequest): Promise<Page<AuditEvent>> {
    return { items: this.events.filter((event) => event.entityType === entityType && event.entityId === entityId).slice(0, page.limit) };
  }

  async getByTraceId(traceId: string, page: PageRequest): Promise<Page<AuditEvent>> {
    return { items: this.events.filter((event) => event.traceId === traceId).slice(0, page.limit) };
  }
}

class InMemoryIdempotencyRepository implements IdempotencyRecordRepository {
  readonly records = new Map<UUID, IdempotencyRecord>();
  readonly keys = new Map<string, UUID>();

  async create(input: Omit<IdempotencyRecord, 'id' | 'createdAt' | 'createdBy'>): Promise<IdempotencyRecord> {
    if (this.keys.has(input.idempotencyKey)) throw new Error('unique idempotency constraint');
    const record: IdempotencyRecord = { ...input, id: `idempotency-${this.records.size + 1}`, createdAt: new Date(), createdBy: 'SYSTEM' };
    this.records.set(record.id, record);
    this.keys.set(record.idempotencyKey, record.id);
    return record;
  }

  async getByKey(key: string): Promise<IdempotencyRecord | null> {
    const id = this.keys.get(key);
    return id ? this.records.get(id) ?? null : null;
  }

  async complete(id: UUID, input: Parameters<IdempotencyRecordRepository['complete']>[1]): Promise<IdempotencyRecord | VersionConflict> {
    const current = this.records.get(id);
    if (!current) throw new Error('idempotency record not found');
    if (current.version !== input.expectedVersion) return { entityId: id, expectedVersion: input.expectedVersion, actualVersion: current.version };
    const { expectedVersion: _expectedVersion, ...changes } = input;
    const updated: IdempotencyRecord = { ...current, ...changes, status: 'COMPLETED', version: current.version + 1 };
    this.records.set(id, updated);
    return updated;
  }
}

function repositories() {
  const workflowSessions = new InMemoryWorkflowRepository();
  const contentBriefVersions = new InMemoryBriefRepository();
  const sourceRecords = new InMemorySourceRepository();
  const auditEvents = new InMemoryAuditRepository();
  const idempotencyRecords = new InMemoryIdempotencyRepository();
  const questionSets = new InMemoryQuestionSetRepository();
  const value = {
    workflowSessions,
    contentBriefVersions,
    questionSets,
    sourceRecords,
    auditEvents,
    idempotencyRecords,
  } as unknown as PersistenceRepositories;
  return { value, workflowSessions, contentBriefVersions, questionSets, sourceRecords, auditEvents, idempotencyRecords };
}

const operatorOne: TrustedOperatorSession = {
  sessionId: 'session-auth-1',
  operatorId: 'operator-1',
  roles: ['OPERATOR'],
  csrfToken: 'csrf-1',
};

function resolver(session: TrustedOperatorSession = operatorOne) {
  return createTrustedSessionResolver({
    async lookupByToken(token) {
      return token === 'opaque-token' ? session : null;
    },
  });
}

function postRequest(body: unknown, idempotencyKey: string): Request {
  return new Request('https://team-tj.example.test/api/copywriter/sessions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'team_tj_session=opaque-token',
      origin: 'https://team-tj.example.test',
      'x-csrf-token': operatorOne.csrfToken,
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });
}

const completeBrief = {
  subject: '低成本做出清晰内容',
  targetAudience: '刚开始做内容的运营人员',
  coreOutcome: '在一小时内完成一篇可审阅笔记',
  painPoint: '面对空白文档时不知道先写什么',
  method: '先列结果，再按步骤补充细节',
  parameters: '使用 3 个步骤和 8 个标签',
  realLimitation: '需要人工核对事实和数据',
  closingAction: '按清单逐项检查后再发布',
};

function serviceFixture() {
  const stores = repositories();
  return { stores, service: new CopywriterService(stores.value) };
}

describe('Copywriter sessions', () => {
  it('uses trusted operator identity and persists the initial immutable brief with provenance', async () => {
    const { stores, service } = serviceFixture();
    const result = await service.create({
      operatorId: operatorOne.operatorId,
      request: {
        brief: { ...completeBrief },
        blockedTermListIds: ['blocked-v1'],
        supplementaryFileIds: [],
        insightMemoryIds: ['insight-v1'],
        operatorProvidedFields: Object.keys(completeBrief) as never,
      },
      idempotencyKey: 'create-1',
      traceId: 'trace-1',
    });

    expect(result.session.operatorId).toBe('operator-1');
    expect(result.session.brief.version).toBe(1);
    expect(result.session.brief.status).toBe('READY');
    expect(result.session.brief.sourceRecordIds).toHaveLength(8);
    expect(stores.contentBriefVersions.records).toHaveLength(1);
    expect(stores.auditEvents.events[0]).toMatchObject({ action: 'GENERATION', actorId: 'operator-1' });
    expect(stores.sourceRecords.records.size).toBe(8);
    expect(result.session.brief.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('creates version 2 on edit, preserves version 1, stores reason, and requires recheck', async () => {
    const { stores, service } = serviceFixture();
    const created = await service.create({
      operatorId: 'operator-1',
      request: { brief: { ...completeBrief }, blockedTermListIds: [], supplementaryFileIds: [], insightMemoryIds: [], operatorProvidedFields: [] },
      idempotencyKey: 'create-2',
      traceId: 'trace-create',
    });

    const updated = await service.update({
      sessionId: created.session.id,
      operatorId: 'operator-1',
      request: { brief: { coreOutcome: '在四十五分钟内完成可审阅笔记' }, blockedTermListIds: [], supplementaryFileIds: [], insightMemoryIds: [], operatorProvidedFields: ['coreOutcome'], editReason: '修正交付时间' },
      expectedVersion: 1,
      idempotencyKey: 'update-1',
      traceId: 'trace-update',
    });

    expect(stores.contentBriefVersions.records.map((brief) => brief.version)).toEqual([1, 2]);
    expect(stores.contentBriefVersions.records[0]!.coreOutcome).toBe(completeBrief.coreOutcome);
    expect(updated.session.status).toBe('COMPLIANCE_CHECK_REQUIRED');
    expect(updated.session.brief.editReason).toBe('修正交付时间');
    expect(stores.auditEvents.events.at(-1)).toMatchObject({ action: 'MANUAL_EDIT', resultStatus: 'RECHECK_REQUIRED' });
  });

  it('deduplicates the same idempotency key and rejects a stale version', async () => {
    const { service } = serviceFixture();
    const request = { brief: { ...completeBrief }, blockedTermListIds: [], supplementaryFileIds: [], insightMemoryIds: [], operatorProvidedFields: [] };
    const first = await service.create({ operatorId: 'operator-1', request, idempotencyKey: 'same-key', traceId: 'trace-1' });
    const duplicate = await service.create({ operatorId: 'operator-1', request, idempotencyKey: 'same-key', traceId: 'trace-2' });
    expect(duplicate).toEqual({ session: first.session, created: false });

    await expect(service.update({
      sessionId: first.session.id,
      operatorId: 'operator-1',
      request: { ...request, brief: { subject: '新主题' }, editReason: '更新主题' },
      expectedVersion: 0,
      idempotencyKey: 'stale-key',
      traceId: 'trace-3',
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 1 });
  });

  it('protects HTTP routes with the trusted session and hides cross-operator sessions', async () => {
    const { service } = serviceFixture();
    const options = { resolveSession: resolver(), allowedOrigins: ['https://team-tj.example.test'] };
    const post = createCopywriterSessionPostHandler(service, options);
    const createdResponse = await post(postRequest({ ...completeBrief, operatorId: 'attacker' }, 'http-create'));
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    expect(created.session.operatorId).toBe('operator-1');

    const get = createCopywriterSessionGetHandler(service, {
      resolveSession: resolver({ ...operatorOne, operatorId: 'operator-2' }),
    });
    const hidden = await get(
      new Request('https://team-tj.example.test/api/copywriter/sessions/session-1', {
        headers: { cookie: 'team_tj_session=opaque-token' },
      }),
      { params: { id: created.session.id } },
    );
    expect(hidden.status).toBe(404);
    expect((await hidden.json()).code).toBe('JOB_NOT_FOUND');
  });

  it('validates patch expected version from the request context and returns safe JSON', async () => {
    const { service } = serviceFixture();
    const options = { resolveSession: resolver(), allowedOrigins: ['https://team-tj.example.test'] };
    const post = createCopywriterSessionPostHandler(service, options);
    await post(postRequest({ ...completeBrief }, 'patch-create'));
    const patch = createCopywriterSessionPatchHandler(service, options);
    const response = await patch(
      new Request('https://team-tj.example.test/api/copywriter/sessions/session-1', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          cookie: 'team_tj_session=opaque-token',
          origin: 'https://team-tj.example.test',
          'x-csrf-token': operatorOne.csrfToken,
          'idempotency-key': 'patch-1',
          'x-expected-version': '1',
        },
        body: JSON.stringify({ brief: { realLimitation: '需要人工复核来源' }, editReason: '补充限制说明' }),
      }),
      { params: { id: 'session-1' } },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).session.brief.version).toBe(2);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});


describe('Copywriter clarification workflow', () => {
  async function createIncomplete() {
    const fixture = serviceFixture();
    const created = await fixture.service.create({
      operatorId: operatorOne.operatorId,
      request: {
        brief: { subject: '内容主题' },
        blockedTermListIds: [],
        supplementaryFileIds: [],
        insightMemoryIds: [],
        operatorProvidedFields: ['subject'],
      },
      idempotencyKey: 'clarify-create',
      traceId: 'clarify-create-trace',
    });
    return { ...fixture, created };
  }

  it('diagnoses any incomplete brief into exactly three deterministic questions', async () => {
    const { service, stores, created } = await createIncomplete();
    const result = await service.clarify({
      sessionId: created.session.id,
      operatorId: operatorOne.operatorId,
      request: { action: 'DIAGNOSE' },
      expectedVersion: 1,
      idempotencyKey: 'diagnose-1',
      traceId: 'diagnose-trace',
    });
    expect(result.questionSet?.questions).toHaveLength(3);
    expect(stores.questionSets.records.size).toBe(1);
    expect(result.session.status).toBe('WAITING_FOR_ANSWERS');
  });

  it('keeps the brief immutable while zero, one, or two answers remain open', async () => {
    const { service, stores, created } = await createIncomplete();
    const diagnosed = await service.clarify({
      sessionId: created.session.id,
      operatorId: operatorOne.operatorId,
      request: { action: 'DIAGNOSE' },
      expectedVersion: 1,
      idempotencyKey: 'diagnose-partial',
      traceId: 'diagnose-partial-trace',
    });
    const questionSetId = diagnosed.questionSet!.id;
    for (const [index, answers] of [[0, [null, null, null]], [1, ['受众', null, null]], [2, ['受众', '结果', null]] ] as const) {
      const result = await service.clarify({
        sessionId: created.session.id,
        operatorId: operatorOne.operatorId,
        request: { action: 'ANSWER', questionSetId, answers },
        expectedVersion: 1,
        idempotencyKey: `partial-${index}`,
        traceId: `partial-${index}-trace`,
      });
      expect(result.waitingForAnswers).toBe(true);
      expect(result.session.status).toBe('WAITING_FOR_ANSWERS');
      expect(stores.contentBriefVersions.records).toHaveLength(1);
    }
  });

  it('merges three answers into a new immutable brief with operator provenance', async () => {
    const { service, stores, created } = await createIncomplete();
    const diagnosed = await service.clarify({
      sessionId: created.session.id,
      operatorId: operatorOne.operatorId,
      request: { action: 'DIAGNOSE' },
      expectedVersion: 1,
      idempotencyKey: 'diagnose-merge',
      traceId: 'diagnose-merge-trace',
    });
    const result = await service.clarify({
      sessionId: created.session.id,
      operatorId: operatorOne.operatorId,
      request: { action: 'ANSWER', questionSetId: diagnosed.questionSet!.id, answers: ['受众', '结果', '痛点'] },
      expectedVersion: 1,
      idempotencyKey: 'answer-merge',
      traceId: 'answer-merge-trace',
    });
    expect(result.session.status).toBe('READY_TO_GENERATE');
    expect(result.session.brief.version).toBe(2);
    expect(result.session.brief.operatorProvidedFields).toEqual(expect.arrayContaining(['targetAudience', 'coreOutcome', 'painPoint']));
    expect(stores.contentBriefVersions.records).toHaveLength(2);
    expect(stores.sourceRecords.records.size).toBe(4);
    expect(stores.questionSets.records.get(diagnosed.questionSet!.id)?.status).toBe('ANSWERED');
  });

  it('declines clarification without changing the brief and records manual fallback', async () => {
    const { service, stores, created } = await createIncomplete();
    const diagnosed = await service.clarify({
      sessionId: created.session.id,
      operatorId: operatorOne.operatorId,
      request: { action: 'DIAGNOSE' },
      expectedVersion: 1,
      idempotencyKey: 'diagnose-decline',
      traceId: 'diagnose-decline-trace',
    });
    const result = await service.clarify({
      sessionId: created.session.id,
      operatorId: operatorOne.operatorId,
      request: { action: 'DECLINE', questionSetId: diagnosed.questionSet!.id, editReason: '改为人工补齐' },
      expectedVersion: 1,
      idempotencyKey: 'decline',
      traceId: 'decline-trace',
    });
    expect(result.declined).toBe(true);
    expect(result.session.status).toBe('BRIEF_EDITING');
    expect(result.session.brief.version).toBe(1);
    expect(stores.auditEvents.events.at(-1)).toMatchObject({ action: 'FALLBACK', resultStatus: 'MANUAL_EDIT_REQUIRED' });
  });
});
