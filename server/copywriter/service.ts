import { createHash } from 'node:crypto';

import type {
  ContentBriefFieldName,
  ContentBriefVersion,
  CopyDraftVersion,
  QuestionSet,
  ThreeAnswers,
  ThreeQuestionFieldBindings,
  UUID,
  WorkflowSession,
} from '@/domain/persistence/models';
import type { PersistenceRepositories } from '@/domain/persistence/repositories';
import {
  AuditEventService,
  ImmutableVersionService,
  PersistenceVersionConflictError,
  SourceRecordService,
} from '@/domain/persistence/services';
import type { PiAiModelAdapter } from '@/server/pi-ai-model-adapter';
import type { ModelMetadata } from '@/domain/persistence/models';
import { PublicApplicationError } from '@/server/public-errors';
import { validateExpectedVersion } from './schema';
import {
  CONTENT_BRIEF_FIELDS,
  type ClarificationInput,
  type CopywriterBriefDto,
  type CopywriterCreateInput,
  type CopywriterPatchInput,
} from './schema';
import { evaluateCopyDraftCompliance, persistCopyDraftCompliance, complianceRequiresOperatorConfirmation } from './compliance';

const IDEMPOTENCY_PREFIX = 'copywriter:';

export type CopyDraftDto = Readonly<Omit<CopyDraftVersion, 'createdAt'> & { readonly createdAt: string }>;

export type CopywriterSessionDto = Readonly<{
  readonly id: UUID;
  readonly operatorId: UUID;
  readonly kind: WorkflowSession['kind'];
  readonly status: string;
  readonly currentVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly brief: CopywriterBriefDto;
}>;

export type ClarificationResult = Readonly<{
  readonly session: CopywriterSessionDto;
  readonly questionSet?: QuestionSetDto;
  readonly waitingForAnswers?: boolean;
  readonly declined?: boolean;
}>;

export type QuestionSetDto = Readonly<{
  readonly id: UUID;
  readonly briefVersion: number;
  readonly questions: readonly string[];
  readonly answers: readonly (string | null)[];
  readonly status: string;
  readonly version: number;
  readonly missingFields: readonly ContentBriefFieldName[];
  readonly createdAt: string;
}>;

const QUESTION_TEMPLATES: Readonly<Record<ContentBriefFieldName, string>> = {
  subject: '这篇内容具体要解决什么主题或场景问题？',
  targetAudience: '这篇内容主要写给哪一类人？',
  coreOutcome: '读者看完后应获得什么具体结果？',
  painPoint: '目标人群当前遇到的具体麻烦是什么？',
  method: '你希望读者照着执行的具体方法或步骤是什么？',
  parameters: '有哪些可验证的数据、参数、工具或口令必须原样保留？',
  realLimitation: '这套方法有哪些真实缺点、限制或注意事项？',
  closingAction: '结尾希望读者采取什么具体行动？',
};

export type CopywriterServiceInput = {
  readonly repositories: PersistenceRepositories;
  readonly now?: () => Date;
  readonly model?: PiAiModelAdapter;
};

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function requiredText(value: string): string {
  return value.trim() ? value : '';
}

function missingFields(fields: Record<ContentBriefFieldName, string>): ContentBriefFieldName[] {
  return CONTENT_BRIEF_FIELDS.filter((field) => !requiredText(fields[field]));
}

function statusFor(fields: Record<ContentBriefFieldName, string>): ContentBriefVersion['status'] {
  return missingFields(fields).length === 0 ? 'READY' : 'DRAFT';
}

function operationKey(operatorId: UUID, key: string): string {
  return `${IDEMPOTENCY_PREFIX}${operatorId}:${key}`;
}

function conflict(error: PersistenceVersionConflictError): PublicApplicationError {
  return new PublicApplicationError({
    code: 'VERSION_CONFLICT',
    currentVersion: error.actualVersion,
  });
}

function notFound(): PublicApplicationError {
  return new PublicApplicationError({ code: 'JOB_NOT_FOUND' });
}

export class CopywriterService {
  private readonly now: () => Date;
  private readonly versions: ImmutableVersionService;
  private readonly sources: SourceRecordService;
  private readonly audits: AuditEventService;
  private readonly model?: PiAiModelAdapter;

  constructor(
    private readonly repositories: PersistenceRepositories,
    options: { readonly now?: () => Date; readonly model?: PiAiModelAdapter } = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.versions = new ImmutableVersionService();
    this.sources = new SourceRecordService(repositories.sourceRecords);
    this.audits = new AuditEventService(repositories.auditEvents, repositories.sourceRecords);
    this.model = options.model;
  }

  async create(input: {
    readonly operatorId: UUID;
    readonly request: CopywriterCreateInput;
    readonly idempotencyKey: string;
    readonly traceId: string;
  }): Promise<{ readonly session: CopywriterSessionDto; readonly created: boolean }> {
    const fields = completeFields(input.request.brief);
    const fingerprint = hash({ operatorId: input.operatorId, request: input.request });
    const idempotency = await this.claimIdempotency({
      key: operationKey(input.operatorId, input.idempotencyKey),
      operatorId: input.operatorId,
      operation: 'create-session',
      entityId: fingerprint,
      inputVersion: 0,
      requestHash: fingerprint,
    });
    if (idempotency.completed && idempotency.resultEntityId) {
      return { session: await this.get({ sessionId: idempotency.resultEntityId, operatorId: input.operatorId }), created: false };
    }

    const session = await this.repositories.workflowSessions.create({
      operatorId: input.operatorId,
      kind: 'COPYWRITER',
      status: statusFor(fields) === 'READY' ? 'READY_TO_GENERATE' : 'BRIEF_EDITING',
    });
    try {
      const brief = await this.appendBrief({
        session,
        operatorId: input.operatorId,
        request: input.request,
        expectedVersion: 0,
        traceId: input.traceId,
      });
      const updated = await this.repositories.workflowSessions.updateStatus(session.id, {
        expectedVersion: session.currentVersion,
        status: sessionStatusFor(brief),
        currentVersion: brief.version,
      });
      if (isConflict(updated)) throw new PublicApplicationError({ code: 'VERSION_CONFLICT' });
      await this.completeIdempotency(idempotency.recordId, 1, session.id, brief.version);
      return { session: this.toDto(updated, brief), created: true };
    } catch (error) {
      if (error instanceof PersistenceVersionConflictError) throw conflict(error);
      throw error;
    }
  }

  async clarify(input: {
    readonly sessionId: UUID;
    readonly operatorId: UUID;
    readonly request: ClarificationInput;
    readonly expectedVersion: number;
    readonly idempotencyKey: string;
    readonly traceId: string;
  }): Promise<ClarificationResult> {
    const session = await this.ownedSession(input.sessionId, input.operatorId);
    const brief = await this.repositories.contentBriefVersions.getLatestBySession(session.id);
    if (!brief) throw notFound();
    if (brief.version !== input.expectedVersion) {
      throw new PublicApplicationError({ code: 'VERSION_CONFLICT', currentVersion: brief.version });
    }
    const missing = missingFields(currentFields(brief));
    if (input.request.action === 'DIAGNOSE') {
      if (!missing.length) {
        const updated = await this.updateSessionStatus(session, 'READY_TO_GENERATE', brief.version);
        return { session: this.toDto(updated, brief) };
      }
      const open = await this.repositories.questionSets.getOpenForBrief(session.id, brief.version);
      const questionSet = open ?? await this.createQuestionSet(session, brief, missing);
      const updated = await this.updateSessionStatus(session, 'WAITING_FOR_ANSWERS', brief.version);
      return { session: this.toDto(updated, brief), questionSet: this.questionSetDto(questionSet, missing), waitingForAnswers: true };
    }
    const questionSet = await this.repositories.questionSets.getById(input.request.questionSetId);
    if (!questionSet || questionSet.sessionId !== session.id || questionSet.briefVersion !== brief.version || questionSet.status !== 'OPEN') {
      throw new PublicApplicationError({ code: 'QUESTION_SET_INVALID' });
    }
    if (input.request.action === 'DECLINE') {
      const declined = await this.repositories.questionSets.answer(questionSet.id, { expectedVersion: questionSet.version, answers: [null, null, null], status: 'DECLINED' });
      if (isConflict(declined)) throw new PublicApplicationError({ code: 'VERSION_CONFLICT', currentVersion: declined.actualVersion });
      const updated = await this.updateSessionStatus(session, 'BRIEF_EDITING', brief.version);
      await this.audits.append({ actorType: 'OPERATOR', actorId: input.operatorId, action: 'FALLBACK', entityType: 'QUESTION_SET', entityId: questionSet.id, reason: input.request.editReason, resultStatus: 'MANUAL_EDIT_REQUIRED', traceId: input.traceId });
      return { session: this.toDto(updated, brief), questionSet: this.questionSetDto(declined as QuestionSet, missing), declined: true };
    }
    const submitted = input.request.answers as ThreeAnswers;
    const answered = submitted.map((answer) => answer?.trim() ? answer.trim() : null) as unknown as ThreeAnswers;
    const answeredCount = answered.filter(Boolean).length;
    if (answeredCount !== 3) {
      const updatedQuestionSet = await this.repositories.questionSets.answer(questionSet.id, { expectedVersion: questionSet.version, answers: answered, status: 'OPEN' });
      if (isConflict(updatedQuestionSet)) throw new PublicApplicationError({ code: 'VERSION_CONFLICT', currentVersion: updatedQuestionSet.actualVersion });
      const updated = await this.updateSessionStatus(session, 'WAITING_FOR_ANSWERS', brief.version);
      return { session: this.toDto(updated, brief), questionSet: this.questionSetDto(updatedQuestionSet as QuestionSet, missing), waitingForAnswers: true };
    }
    const merged: CopywriterCreateInput = {
      brief: Object.fromEntries(questionSet.fieldBindings.map((field, index) => [field, answered[index]])),
      blockedTermListIds: brief.blockedTermListIds,
      supplementaryFileIds: brief.supplementaryFileIds,
      insightMemoryIds: brief.insightMemoryIds,
      operatorProvidedFields: [...new Set([...brief.operatorProvidedFields, ...questionSet.fieldBindings])],
      editReason: '合并澄清问题的 Operator 回答',
    };
    const nextBrief = await this.appendBrief({ session, operatorId: input.operatorId, request: merged, expectedVersion: brief.version, traceId: input.traceId, previous: brief });
    const answeredSet = await this.repositories.questionSets.answer(questionSet.id, { expectedVersion: questionSet.version, answers: answered, status: 'ANSWERED', answeredAt: this.now() });
    if (isConflict(answeredSet)) throw new PublicApplicationError({ code: 'VERSION_CONFLICT', currentVersion: answeredSet.actualVersion });
    const updated = await this.updateSessionStatus(session, 'READY_TO_GENERATE', nextBrief.version);
    return { session: this.toDto(updated, nextBrief), questionSet: this.questionSetDto(answeredSet as QuestionSet, nextBrief.missingFields) };
  }

  private async createQuestionSet(session: WorkflowSession, brief: ContentBriefVersion, missing: readonly ContentBriefFieldName[]): Promise<QuestionSet> {
    const bindings = [missing[0] ?? 'subject', missing[1] ?? missing[0] ?? 'subject', missing[2] ?? missing[1] ?? missing[0] ?? 'subject'] as ThreeQuestionFieldBindings;
    return this.repositories.questionSets.create({ sessionId: session.id, briefVersion: brief.version, questions: bindings.map((field) => QUESTION_TEMPLATES[field]) as [string, string, string], fieldBindings: bindings, answers: [null, null, null], version: 1, status: 'OPEN' });
  }

  private async updateSessionStatus(session: WorkflowSession, status: WorkflowSession['status'], currentVersion: number): Promise<WorkflowSession> {
    const updated = await this.repositories.workflowSessions.updateStatus(session.id, { expectedVersion: session.currentVersion, status, currentVersion });
    if (isConflict(updated)) throw new PublicApplicationError({ code: 'VERSION_CONFLICT', currentVersion: updated.actualVersion });
    return updated;
  }

  private questionSetDto(questionSet: QuestionSet, missingFields: readonly ContentBriefFieldName[]): QuestionSetDto {
    return { id: questionSet.id, briefVersion: questionSet.briefVersion, questions: questionSet.questions, answers: questionSet.answers, status: questionSet.status, version: questionSet.version, missingFields, createdAt: questionSet.createdAt.toISOString() };
  }

  async get(input: { readonly sessionId: UUID; readonly operatorId: UUID }): Promise<CopywriterSessionDto> {
    const session = await this.ownedSession(input.sessionId, input.operatorId);
    const brief = await this.repositories.contentBriefVersions.getLatestBySession(session.id);
    if (!brief) throw notFound();
    return this.toDto(session, brief);
  }

  async update(input: {
    readonly sessionId: UUID;
    readonly operatorId: UUID;
    readonly request: CopywriterPatchInput;
    readonly expectedVersion: number;
    readonly idempotencyKey: string;
    readonly traceId: string;
  }): Promise<{ readonly session: CopywriterSessionDto; readonly created: boolean }> {
    const expectedVersion = validateExpectedVersion(input.expectedVersion);
    const session = await this.ownedSession(input.sessionId, input.operatorId);
    const current = await this.repositories.contentBriefVersions.getLatestBySession(session.id);
    if (!current) throw notFound();
    const fingerprint = hash({
      operatorId: input.operatorId,
      sessionId: input.sessionId,
      expectedVersion,
      request: input.request,
    });
    const idempotency = await this.claimIdempotency({
      key: operationKey(input.operatorId, input.idempotencyKey),
      operatorId: input.operatorId,
      operation: 'update-brief',
      entityId: input.sessionId,
      inputVersion: expectedVersion,
      requestHash: fingerprint,
    });
    if (idempotency.completed && idempotency.resultEntityId) {
      return { session: await this.get({ sessionId: input.sessionId, operatorId: input.operatorId }), created: false };
    }
    if (current.version !== expectedVersion) {
      throw new PublicApplicationError({ code: 'VERSION_CONFLICT', currentVersion: current.version });
    }

    const request: CopywriterCreateInput = {
      ...input.request,
      brief: { ...currentFields(current), ...input.request.brief },
      operatorProvidedFields: [
        ...new Set([
          ...current.operatorProvidedFields,
          ...input.request.operatorProvidedFields,
        ]),
      ],
    };
    try {
      const brief = await this.appendBrief({
        session,
        operatorId: input.operatorId,
        request,
        expectedVersion,
        traceId: input.traceId,
        previous: current,
      });
      const updated = await this.repositories.workflowSessions.updateStatus(session.id, {
        expectedVersion: session.currentVersion,
        status: 'COMPLIANCE_CHECK_REQUIRED',
        currentVersion: brief.version,
      });
      if (isConflict(updated)) {
        throw new PublicApplicationError({ code: 'VERSION_CONFLICT', currentVersion: updated.actualVersion });
      }
      await this.completeIdempotency(idempotency.recordId, 1, session.id, brief.version);
      return { session: this.toDto(updated, brief), created: true };
    } catch (error) {
      if (error instanceof PersistenceVersionConflictError) throw conflict(error);
      throw error;
    }
  }

  private async appendBrief(input: {
    readonly session: WorkflowSession;
    readonly operatorId: UUID;
    readonly request: CopywriterCreateInput;
    readonly expectedVersion: number;
    readonly traceId: string;
    readonly previous?: ContentBriefVersion;
  }): Promise<ContentBriefVersion> {
    const fields = completeFields(input.request.brief);
    const missing = missingFields(fields);
    const sourceRecordIds: UUID[] = [];
    for (const field of CONTENT_BRIEF_FIELDS) {
      if (!fields[field]) continue;
      const source = await this.sources.create({
        sourceType: 'BRIEF_FIELD',
        sourceRef: `content-brief:${input.session.id}:${field}`,
        version: input.expectedVersion + 1,
        contentHash: hash({ field, value: fields[field] }),
        capturedAt: this.now(),
        operatorId: input.operatorId,
        parentSourceRecordIds: input.previous?.sourceRecordIds ?? [],
        accessLimitations: [],
        redactionStatus: 'NOT_REQUIRED',
      });
      sourceRecordIds.push(source.id);
    }
    const contentHash = hash({
      fields,
      blockedTermListIds: input.request.blockedTermListIds,
      supplementaryFileIds: input.request.supplementaryFileIds,
      insightMemoryIds: input.request.insightMemoryIds,
    });
    const brief = await this.versions.append({
      repository: this.repositories.contentBriefVersions,
      sessionId: input.session.id,
      expectedVersion: input.expectedVersion,
      input: {
        ...fields,
        status: missing.length === 0 ? 'READY' : 'DRAFT',
        blockedTermListIds: input.request.blockedTermListIds,
        sourceRecordIds,
        supplementaryFileIds: input.request.supplementaryFileIds,
        insightMemoryIds: input.request.insightMemoryIds,
        operatorProvidedFields: input.request.operatorProvidedFields,
        missingFields: missing,
        contentHash,
        ...(input.request.editReason ? { editReason: input.request.editReason } : {}),
        editedBy: input.operatorId,
      },
    });
    await this.sources.linkMany({
      sourceRecordIds,
      entityType: 'CONTENT_BRIEF_VERSION',
      entityId: brief.id,
      role: 'BRIEF_FIELD',
    });
    await this.audits.append({
      actorType: 'OPERATOR',
      actorId: input.operatorId,
      action: input.previous ? 'MANUAL_EDIT' : 'GENERATION',
      entityType: 'CONTENT_BRIEF_VERSION',
      entityId: brief.id,
      beforeHash: input.previous?.contentHash,
      afterHash: brief.contentHash,
      reason: input.request.editReason,
      resultStatus: input.previous ? 'RECHECK_REQUIRED' : 'CREATED',
      sourceRecordId: sourceRecordIds[0],
      traceId: input.traceId,
    });
    return brief;
  }

  private async ownedSession(sessionId: UUID, operatorId: UUID): Promise<WorkflowSession> {
    const session = await this.repositories.workflowSessions.getById(sessionId);
    if (!session || session.operatorId !== operatorId || session.kind !== 'COPYWRITER') throw notFound();
    return session;
  }

  private toDto(session: WorkflowSession, brief: ContentBriefVersion): CopywriterSessionDto {
    return {
      id: session.id,
      operatorId: session.operatorId,
      kind: session.kind,
      status: session.status,
      currentVersion: session.currentVersion,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      brief: {
        id: brief.id,
        sessionId: brief.sessionId,
        version: brief.version,
        status: brief.status,
        subject: brief.subject,
        targetAudience: brief.targetAudience,
        coreOutcome: brief.coreOutcome,
        painPoint: brief.painPoint,
        method: brief.method,
        parameters: brief.parameters,
        realLimitation: brief.realLimitation,
        closingAction: brief.closingAction,
        missingFields: brief.missingFields,
        operatorProvidedFields: brief.operatorProvidedFields,
        blockedTermListIds: brief.blockedTermListIds,
        supplementaryFileIds: brief.supplementaryFileIds,
        insightMemoryIds: brief.insightMemoryIds,
        sourceRecordIds: brief.sourceRecordIds,
        contentHash: brief.contentHash,
        ...(brief.editReason ? { editReason: brief.editReason } : {}),
        ...(brief.editedBy ? { editedBy: brief.editedBy } : {}),
        createdAt: brief.createdAt.toISOString(),
      },
    };
  }

  async generateDraft(input: {
    readonly sessionId: UUID;
    readonly operatorId: UUID;
    readonly request: { readonly contentType?: 'tutorial' | 'experience' | 'showcase' };
    readonly idempotencyKey: string;
    readonly traceId: string;
  readonly model?: PiAiModelAdapter;
}): Promise<{ readonly draft: CopyDraftDto; readonly created: boolean }> {
    const session = await this.ownedSession(input.sessionId, input.operatorId);
    const brief = await this.repositories.contentBriefVersions.getLatestBySession(session.id);
    if (!brief || brief.status !== 'READY') throw new PublicApplicationError({ code: 'BRIEF_INCOMPLETE' });
    const existing = await this.repositories.copyDraftVersions.getLatestBySession(session.id);
    const fingerprint = hash({ sessionId: input.sessionId, brief: brief.version, request: input.request });
    const idempotency = await this.claimIdempotency({ key: operationKey(input.operatorId, input.idempotencyKey), operatorId: input.operatorId, operation: 'generate-draft', entityId: input.sessionId, inputVersion: brief.version, requestHash: fingerprint });
    if (idempotency.completed && idempotency.resultEntityId) return { draft: await this.getDraft({ sessionId: input.sessionId, operatorId: input.operatorId }), created: false };
    const adapter = input.model ?? this.model;
    if (!adapter) throw new PublicApplicationError({ code: 'CONFIGURATION_MISSING' });
    const validation = await import('./draft-validation').then(({ generateAndValidateCopyDraft }) => generateAndValidateCopyDraft(adapter, { jobId: input.idempotencyKey, entityId: session.id, brief, traceId: input.traceId, contentType: input.request.contentType }));
    const draft = await this.appendDraft({ session, operatorId: input.operatorId, brief, candidate: validation.candidate, validation, expectedVersion: existing?.version ?? 0, traceId: input.traceId });
    await this.completeIdempotency(idempotency.recordId, 1, draft.id, draft.version);
    return { draft: this.toDraftDto(draft), created: true };
  }

  async getDraft(input: { readonly sessionId: UUID; readonly operatorId: UUID; readonly version?: number }): Promise<CopyDraftDto> {
    const session = await this.ownedSession(input.sessionId, input.operatorId);
    const draft = input.version === undefined ? await this.repositories.copyDraftVersions.getLatestBySession(session.id) : await this.repositories.copyDraftVersions.getBySessionVersion(session.id, input.version);
    if (!draft) throw notFound();
    return this.toDraftDto(draft);
  }

  async editDraft(input: {
    readonly sessionId: UUID;
    readonly operatorId: UUID;
    readonly expectedVersion: number;
    readonly idempotencyKey: string;
    readonly traceId: string;
    readonly request: { readonly draft: Record<string, unknown>; readonly editReason: string };
  }): Promise<{ readonly draft: CopyDraftDto; readonly created: boolean }> {
    const session = await this.ownedSession(input.sessionId, input.operatorId);
    const current = await this.repositories.copyDraftVersions.getLatestBySession(session.id);
    const brief = await this.repositories.contentBriefVersions.getLatestBySession(session.id);
    if (!current || !brief) throw notFound();
    if (current.version !== input.expectedVersion) throw new PublicApplicationError({ code: 'VERSION_CONFLICT', currentVersion: current.version });
    const fingerprint = hash({ sessionId: input.sessionId, expectedVersion: input.expectedVersion, request: input.request });
    const idempotency = await this.claimIdempotency({ key: operationKey(input.operatorId, input.idempotencyKey), operatorId: input.operatorId, operation: 'edit-draft', entityId: input.sessionId, inputVersion: input.expectedVersion, requestHash: fingerprint });
    if (idempotency.completed && idempotency.resultEntityId) return { draft: await this.getDraft({ sessionId: input.sessionId, operatorId: input.operatorId }), created: false };
    const { parseCopyDraftCandidate, validateSourceRules } = await import('./draft-validation');
    let candidate;
    try { candidate = parseCopyDraftCandidate(input.request.draft); } catch { throw new PublicApplicationError({ code: 'VALIDATION_FAILED', fieldErrors: { draft: ['The edited draft does not match the fixed Copy_Draft structure.'] } }); }
    const validation = validateSourceRules(candidate, brief);
    const draft = await this.appendDraft({ session, operatorId: input.operatorId, brief, candidate, validation, expectedVersion: current.version, traceId: input.traceId, editReason: input.request.editReason, previous: current });
    await this.completeIdempotency(idempotency.recordId, 1, draft.id, draft.version);
    return { draft: this.toDraftDto(draft), created: true };
  }

  async confirmDraft(input: { readonly sessionId: UUID; readonly operatorId: UUID; readonly version: number; readonly idempotencyKey: string; readonly traceId: string }): Promise<{ readonly draft: CopyDraftDto; readonly confirmed: true }> {
    const session = await this.ownedSession(input.sessionId, input.operatorId);
    const draft = await this.repositories.copyDraftVersions.getBySessionVersion(session.id, input.version);
    if (!draft) throw notFound();
    if (draft.version !== (await this.repositories.copyDraftVersions.getLatestBySession(session.id))?.version) throw new PublicApplicationError({ code: 'CONFIRMATION_REQUIRED' });
    if (draft.validationStatus !== 'PASSED' || draft.complianceStatus !== 'PASSED' || draft.needsOperatorConfirmation) throw new PublicApplicationError({ code: 'CONFIRMATION_REQUIRED' });
    const key = operationKey(input.operatorId, input.idempotencyKey);
    const fingerprint = hash({ sessionId: input.sessionId, version: input.version });
    const idempotency = await this.claimIdempotency({ key, operatorId: input.operatorId, operation: 'confirm-draft', entityId: draft.id, inputVersion: input.version, requestHash: fingerprint });
    if (!idempotency.completed) {
      await this.audits.append({ actorType: 'OPERATOR', actorId: input.operatorId, action: 'CONFIRM_VERSION', entityType: 'COPY_DRAFT_VERSION', entityId: draft.id, reason: '确认生成前版本', resultStatus: 'CONFIRMED', sourceRecordId: draft.sourceRecordIds[0], traceId: input.traceId });
      await this.completeIdempotency(idempotency.recordId, 1, draft.id, draft.version);
    }
    return { draft: this.toDraftDto(draft), confirmed: true };
  }

  private async appendDraft(input: { readonly session: WorkflowSession; readonly operatorId: UUID; readonly brief: ContentBriefVersion; readonly candidate: import('./draft-validation').CopyDraftCandidate; readonly validation: import('./draft-validation').DraftValidationResult & { readonly modelMetadata?: ModelMetadata }; readonly expectedVersion: number; readonly traceId: string; readonly editReason?: string; readonly previous?: import('@/domain/persistence/models').CopyDraftVersion }): Promise<import('@/domain/persistence/models').CopyDraftVersion> {
    const sourceRecordIds = [...new Set([...input.candidate.sourceRecordIds, ...input.brief.sourceRecordIds])];
    const compliance = await evaluateCopyDraftCompliance(input.candidate, { blockedTermListIds: input.brief.blockedTermListIds, sourceRecordIds: input.brief.sourceRecordIds }, this.repositories);
    const contentHash = hash(input.candidate);
    const draft = await this.versions.append({ repository: this.repositories.copyDraftVersions, sessionId: input.session.id, expectedVersion: input.expectedVersion, input: { targetAudience: input.candidate.targetAudience, targetEmotion: input.candidate.targetEmotion, titles: input.candidate.titles as [string,string,string,string,string], opening: input.candidate.opening, firstThreeLines: input.candidate.firstThreeLines, painPoint: input.candidate.painPoint, method: input.candidate.method, realLimitation: input.candidate.realLimitation, body: input.candidate.body, bodyPoints: input.candidate.bodyPoints as [string,string,string], interactionEnding: input.candidate.interactionEnding, tags: input.candidate.tags as [string,string,string,string,string,string,string,string], tagBuckets: { broad: input.candidate.tagBuckets.broad as [string,string,string], medium: input.candidate.tagBuckets.medium as [string,string,string], longTail: input.candidate.tagBuckets.longTail as [string,string] }, appliedRuleIds: input.validation.ruleResults.map((result) => result.ruleId) as UUID[], validationStatus: input.validation.errors.length ? 'FAILED' : input.validation.needsOperatorConfirmation ? 'NEEDS_OPERATOR_CONFIRMATION' : 'PASSED', complianceStatus: compliance.status === 'NO_MATCH' ? 'PASSED' : 'ISSUES_FOUND', needsOperatorConfirmation: input.validation.needsOperatorConfirmation || complianceRequiresOperatorConfirmation(compliance), ...(input.validation.modelMetadata ? { modelMetadata: input.validation.modelMetadata } : {}), sourceRecordIds, contentHash, ...(input.editReason ? { editReason: input.editReason } : {}), editedBy: input.operatorId } });
    await persistCopyDraftCompliance(this.repositories, draft.id, compliance);
    await this.sources.linkMany({ sourceRecordIds, entityType: 'COPY_DRAFT_VERSION', entityId: draft.id, role: input.editReason ? 'HUMAN_EDIT' : 'GENERATION' });
    await this.audits.append({ actorType: 'OPERATOR', actorId: input.operatorId, action: input.editReason ? 'MANUAL_EDIT' : 'GENERATION', entityType: 'COPY_DRAFT_VERSION', entityId: draft.id, beforeHash: input.previous?.contentHash, afterHash: draft.contentHash, reason: input.editReason, resultStatus: input.validation.errors.length ? 'NEEDS_OPERATOR_CONFIRMATION' : 'RECHECK_REQUIRED', sourceRecordId: sourceRecordIds[0], traceId: input.traceId });
    return draft;
  }

  private toDraftDto(draft: import('@/domain/persistence/models').CopyDraftVersion): CopyDraftDto {
    return { ...draft, createdAt: draft.createdAt.toISOString(), modelMetadata: draft.modelMetadata };
  }

  private async claimIdempotency(input: {
    readonly key: string;
    readonly operatorId: UUID;
    readonly operation: string;
    readonly entityId: UUID;
    readonly inputVersion: number;
    readonly requestHash: string;
  }): Promise<{ readonly recordId: UUID; readonly completed: boolean; readonly resultEntityId?: UUID }> {
    const existing = await this.repositories.idempotencyRecords.getByKey(input.key);
    if (existing) {
      if (
        existing.jobId !== input.operatorId ||
        existing.step !== `${input.operation}:${input.requestHash}` ||
        existing.entityId !== input.entityId ||
        existing.inputVersion !== input.inputVersion
      ) {
        throw new PublicApplicationError({ code: 'REQUEST_INVALID', fieldErrors: { idempotencyKey: ['This key is already associated with different inputs.'] } });
      }
      return { recordId: existing.id, completed: existing.status === 'COMPLETED', resultEntityId: existing.resultEntityId };
    }
    try {
      const record = await this.repositories.idempotencyRecords.create({
        idempotencyKey: input.key,
        jobId: input.operatorId,
        inputVersion: input.inputVersion,
        step: `${input.operation}:${input.requestHash}`,
        entityId: input.entityId,
        status: 'IN_PROGRESS',
        version: 1,
      });
      return { recordId: record.id, completed: false };
    } catch {
      const raced = await this.repositories.idempotencyRecords.getByKey(input.key);
      if (!raced || raced.step !== `${input.operation}:${input.requestHash}`) throw new PublicApplicationError({ code: 'REQUEST_INVALID' });
      return { recordId: raced.id, completed: raced.status === 'COMPLETED', resultEntityId: raced.resultEntityId };
    }
  }

  private async completeIdempotency(id: UUID, expectedVersion: number, resultEntityId: UUID, resultVersion: number): Promise<void> {
    const result = await this.repositories.idempotencyRecords.complete(id, {
      expectedVersion,
      resultEntityId,
      resultVersion,
      completedAt: this.now(),
    });
    if (isConflict(result)) throw new PublicApplicationError({ code: 'VERSION_CONFLICT', currentVersion: result.actualVersion });
  }
}

function completeFields(patch: Partial<Record<ContentBriefFieldName, string>>): Record<ContentBriefFieldName, string> {
  return Object.fromEntries(CONTENT_BRIEF_FIELDS.map((field) => [field, patch[field] ?? ''])) as Record<ContentBriefFieldName, string>;
}

function currentFields(brief: ContentBriefVersion): Record<ContentBriefFieldName, string> {
  return completeFields(brief);
}

function sessionStatusFor(brief: ContentBriefVersion): WorkflowSession['status'] {
  return brief.status === 'READY' ? 'READY_TO_GENERATE' : 'BRIEF_EDITING';
}

function isConflict(value: unknown): value is { readonly actualVersion: number } {
  return Boolean(value && typeof value === 'object' && 'actualVersion' in value);
}
