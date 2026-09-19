import { createHash } from 'node:crypto';
import type {
  AccountMode,
  JsonObject,
  ManualContentInput,
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
import { PublicApplicationError } from '@/server/public-errors';
import type {
  AuthorizationConfirmationRequest,
  FetchRequest,
  ManualContentRequest,
  ReviewCreateRequest,
  NormalizedNoteUrl,
} from './schema';
import { normalizeNoteUrl } from './schema';
import type { JobService } from '@/server/jobs/service';
import type { OpenCliFetchResult, OpenCliGatewayAdapter } from './opencli-gateway';

const PREFIX = 'review:';
const LIMITATIONS = [
  '账号登录和 OpenCLI 配置由 Operator 负责',
  '公开数据可访问性受小红书平台限制',
  '不得绕过平台条款、访问控制或反爬机制',
  '指标缺失时必须人工输入，系统不会推断',
];

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const conflict = (error: PersistenceVersionConflictError) =>
  new PublicApplicationError({ code: 'VERSION_CONFLICT', currentVersion: error.actualVersion });
const notFound = () => new PublicApplicationError({ code: 'JOB_NOT_FOUND' });
const isConflict = (value: unknown): value is { readonly actualVersion: number } =>
  Boolean(value && typeof value === 'object' && 'actualVersion' in value);

type ReviewDto = Readonly<{
  id: UUID;
  operatorId: UUID;
  kind: WorkflowSession['kind'];
  status: WorkflowSession['status'];
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  noteUrl?: { raw: string; normalized: string };
  manualContent?: {
    id: UUID;
    version: number;
    title?: string;
    body?: string;
    coverDescription?: string;
    metricValues: JsonObject;
    sourceRecordId: UUID;
    contentHash: string;
    createdAt: string;
  };
  limitations: readonly string[];
}>;

export class ReviewService {
  private readonly versions = new ImmutableVersionService();
  private readonly sources: SourceRecordService;
  private readonly audits: AuditEventService;
  private readonly now: () => Date;
  private readonly jobService?: JobService;
  private readonly gateway?: OpenCliGatewayAdapter;

  constructor(
    private readonly repositories: PersistenceRepositories,
    options: { now?: () => Date; jobService?: JobService; gateway?: OpenCliGatewayAdapter } = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.jobService = options.jobService;
    this.gateway = options.gateway;
    this.sources = new SourceRecordService(repositories.sourceRecords);
    this.audits = new AuditEventService(repositories.auditEvents, repositories.sourceRecords);
  }

  async create(input: {
    operatorId: UUID;
    request: ReviewCreateRequest;
    idempotencyKey: string;
    traceId: string;
  }): Promise<{ review: ReviewDto; created: boolean }> {
    const fingerprint = hash({ operatorId: input.operatorId, request: input.request });
    const claim = await this.claim(
      input.operatorId,
      input.idempotencyKey,
      fingerprint,
      'create',
      fingerprint,
      0,
    );
    if (claim.completed && claim.resultEntityId)
      return {
        review: await this.get({ reviewId: claim.resultEntityId, operatorId: input.operatorId }),
        created: false,
      };

    const session = await this.repositories.workflowSessions.create({
      operatorId: input.operatorId,
      kind: 'REVIEWER',
      status:
        input.request.noteUrl && !input.request.manualContent ? 'AUTH_REQUIRED' : 'MANUAL_INPUT',
    });
    try {
      let manual: ManualContentInput | undefined;
      if (input.request.noteUrl) {
        const source = await this.sources.createAndLink({
          record: {
            sourceType: 'URL',
            sourceRef: input.request.noteUrl.raw,
            version: 1,
            contentHash: hash(input.request.noteUrl.normalized),
            capturedAt: this.now(),
            operatorId: input.operatorId,
            parentSourceRecordIds: [],
            accessLimitations: LIMITATIONS,
            redactionStatus: 'NOT_REQUIRED',
          },
          link: { entityType: 'WORKFLOW_SESSION', entityId: session.id, role: 'NOTE_URL' },
        });
        await this.audits.append({
          actorType: 'OPERATOR',
          actorId: input.operatorId,
          action: 'ACCESS',
          entityType: 'WORKFLOW_SESSION',
          entityId: session.id,
          resultStatus: 'AUTH_REQUIRED',
          sourceRecordId: source.id,
          reason: 'Note_URL submitted; authorization is required before any access.',
          traceId: input.traceId,
        });
      }
      if (input.request.manualContent)
        manual = await this.appendManualVersion({
          session,
          operatorId: input.operatorId,
          request: input.request.manualContent,
          expectedVersion: 0,
          traceId: input.traceId,
        });
      const updated = manual
        ? await this.repositories.workflowSessions.updateStatus(session.id, {
            expectedVersion: session.currentVersion,
            status: 'MANUAL_INPUT',
            currentVersion: manual.version,
          })
        : session;
      if (isConflict(updated))
        throw new PublicApplicationError({
          code: 'VERSION_CONFLICT',
          currentVersion: updated.actualVersion,
        });
      await this.complete(claim.recordId, session.id, manual?.version ?? 0);
      return {
        review: this.toDto(updated as WorkflowSession, input.request.noteUrl, manual),
        created: true,
      };
    } catch (error) {
      if (error instanceof PersistenceVersionConflictError) throw conflict(error);
      throw error;
    }
  }

  async get(input: { reviewId: UUID; operatorId: UUID }): Promise<ReviewDto> {
    const session = await this.owned(input.reviewId, input.operatorId);
    const manual = await this.repositories.manualContentInputs.getLatestBySession(session.id);
    const links = await this.sources.getLinksForEntity('WORKFLOW_SESSION', session.id);
    const urlSourceId = links.find((link) => link.role === 'NOTE_URL')?.sourceRecordId;
    const urlSource = urlSourceId
      ? await this.repositories.sourceRecords.getById(urlSourceId)
      : null;
    const noteUrl = urlSource
      ? { raw: urlSource.sourceRef, normalized: urlSource.sourceRef.replace(/\/+$/, '') }
      : undefined;
    return this.toDto(session, noteUrl, manual ?? undefined);
  }

  async confirmAuthorization(input: {
    operatorId: UUID;
    reviewId: UUID;
    request: AuthorizationConfirmationRequest;
    expectedVersion: number;
    idempotencyKey: string;
    traceId: string;
  }): Promise<{
    review: ReviewDto;
    authorization: {
      id: UUID;
      reviewId: UUID;
      exactNoteUrl: string;
      normalizedNoteUrl: string;
      toolId: string;
      purpose: string;
      accountMode: AccountMode;
      confirmedAt: string;
      expiresAt?: string;
      version: number;
    };
    created: boolean;
  }> {
    const session = await this.owned(input.reviewId, input.operatorId);
    const links = await this.sources.getLinksForEntity('WORKFLOW_SESSION', session.id);
    const urlLink = links.find((link) => link.role === 'NOTE_URL');
    const urlSource = urlLink
      ? await this.repositories.sourceRecords.getById(urlLink.sourceRecordId)
      : null;
    if (!urlSource) throw new PublicApplicationError({ code: 'AUTHORIZATION_REQUIRED' });
    const storedUrl = normalizeNoteUrl(urlSource.sourceRef);
    if (
      storedUrl.raw !== input.request.exactNoteUrl.raw ||
      storedUrl.normalized !== input.request.exactNoteUrl.normalized
    )
      throw new PublicApplicationError({ code: 'AUTHORIZATION_REQUIRED' });
    if (session.status !== 'AUTH_REQUIRED' && session.status !== 'AUTH_CONFIRMED')
      throw new PublicApplicationError({ code: 'AUTHORIZATION_REQUIRED' });
    const fingerprint = hash({
      operatorId: input.operatorId,
      reviewId: input.reviewId,
      expectedVersion: input.expectedVersion,
      request: input.request,
    });
    const claim = await this.claim(
      input.operatorId,
      input.idempotencyKey,
      fingerprint,
      'authorization',
      input.reviewId,
      input.expectedVersion,
    );
    if (claim.completed)
      return {
        review: await this.get({ reviewId: input.reviewId, operatorId: input.operatorId }),
        authorization: await this.authorizationDto(claim.resultEntityId ?? input.reviewId),
        created: false,
      };
    if (session.currentVersion !== input.expectedVersion)
      throw new PublicApplicationError({
        code: 'VERSION_CONFLICT',
        currentVersion: session.currentVersion,
      });
    try {
      const authorization = await this.repositories.accessAuthorizations.create({
        reviewId: session.id,
        exactNoteUrl: storedUrl.raw,
        normalizedNoteUrl: storedUrl.normalized,
        toolId: input.request.toolId,
        purpose: input.request.purpose,
        accountMode: input.request.accountMode,
        confirmedAt: input.request.confirmedAt,
        operatorId: input.operatorId,
        ...(input.request.expiresAt ? { expiresAt: input.request.expiresAt } : {}),
        confirmationVersion: session.currentVersion + 1,
        version: 1,
      });
      const source = await this.sources.createAndLink({
        record: {
          sourceType: 'AUTHORIZATION',
          sourceRef: `authorization:${authorization.id}`,
          version: 1,
          contentHash: hash({
            reviewId: session.id,
            exactNoteUrl: storedUrl.normalized,
            toolId: authorization.toolId,
            purpose: authorization.purpose,
            accountMode: authorization.accountMode,
            confirmedAt: authorization.confirmedAt,
            expiresAt: authorization.expiresAt,
          }),
          capturedAt: this.now(),
          operatorId: input.operatorId,
          parentSourceRecordIds: [urlSource.id],
          accessLimitations: LIMITATIONS,
          redactionStatus: 'NOT_REQUIRED',
        },
        link: { entityType: 'WORKFLOW_SESSION', entityId: session.id, role: 'AUTHORIZATION' },
      });
      await this.audits.append({
        actorType: 'OPERATOR',
        actorId: input.operatorId,
        action: 'CONFIRMATION',
        entityType: 'ACCESS_AUTHORIZATION',
        entityId: authorization.id,
        resultStatus: 'CONFIRMED',
        sourceRecordId: source.id,
        reason: 'Operator confirmed access for the exact submitted Note_URL.',
        toolId: authorization.toolId,
        traceId: input.traceId,
      });
      const updated = await this.repositories.workflowSessions.updateStatus(session.id, {
        expectedVersion: session.currentVersion,
        status: 'AUTH_CONFIRMED',
        currentVersion: authorization.confirmationVersion,
      });
      if (isConflict(updated))
        throw new PublicApplicationError({
          code: 'VERSION_CONFLICT',
          currentVersion: updated.actualVersion,
        });
      await this.complete(claim.recordId, authorization.id, authorization.version);
      return {
        review: this.toDto(updated as WorkflowSession, storedUrl),
        authorization: this.toAuthorizationDto(authorization),
        created: true,
      };
    } catch (error) {
      if (error instanceof PersistenceVersionConflictError) throw conflict(error);
      throw error;
    }
  }

  private async authorizationDto(
    id: UUID,
  ): Promise<{
    id: UUID;
    reviewId: UUID;
    exactNoteUrl: string;
    normalizedNoteUrl: string;
    toolId: string;
    purpose: string;
    accountMode: AccountMode;
    confirmedAt: string;
    expiresAt?: string;
    version: number;
  }> {
    const authorization = await this.repositories.accessAuthorizations.getById(id);
    if (!authorization) throw new PublicApplicationError({ code: 'AUTHORIZATION_REQUIRED' });
    return this.toAuthorizationDto(authorization);
  }

  private toAuthorizationDto(authorization: {
    id: UUID;
    reviewId: UUID;
    exactNoteUrl: string;
    normalizedNoteUrl: string;
    toolId: string;
    purpose: string;
    accountMode: AccountMode;
    confirmedAt: Date;
    expiresAt?: Date;
    version: number;
  }) {
    return {
      id: authorization.id,
      reviewId: authorization.reviewId,
      exactNoteUrl: authorization.exactNoteUrl,
      normalizedNoteUrl: authorization.normalizedNoteUrl,
      toolId: authorization.toolId,
      purpose: authorization.purpose,
      accountMode: authorization.accountMode,
      confirmedAt: authorization.confirmedAt.toISOString(),
      ...(authorization.expiresAt ? { expiresAt: authorization.expiresAt.toISOString() } : {}),
      version: authorization.version,
    };
  }
  async fetch(input: {
    operatorId: UUID;
    reviewId: UUID;
    request: FetchRequest;
    expectedVersion: number;
    idempotencyKey: string;
    traceId: string;
  }): Promise<{ job: import('@/domain/persistence/models').Job; created: boolean }> {
    const jobService = this.jobService;
    const gateway = this.gateway;
    if (!jobService || !gateway) throw new PublicApplicationError({ code: 'CONFIGURATION_MISSING' });

    const session = await this.owned(input.reviewId, input.operatorId);
    if (session.currentVersion !== input.expectedVersion)
      throw new PublicApplicationError({ code: 'VERSION_CONFLICT', currentVersion: session.currentVersion });
    if (session.status !== 'AUTH_CONFIRMED' && session.status !== 'ACCESS_FAILED')
      throw new PublicApplicationError({ code: 'AUTHORIZATION_REQUIRED' });

    const urlSource = await this.reviewUrlSource(session.id);
    if (!urlSource) throw new PublicApplicationError({ code: 'AUTHORIZATION_REQUIRED' });
    const exactNoteUrl = normalizeNoteUrl(urlSource.sourceRef);
    const authorization = await this.repositories.accessAuthorizations.getValidForExactRequest({
      reviewId: session.id,
      exactNoteUrl: exactNoteUrl.normalized,
      toolId: input.request.toolId,
      purpose: input.request.purpose,
      accountMode: input.request.accountMode,
      at: this.now(),
    });
    if (!authorization) throw new PublicApplicationError({ code: 'AUTHORIZATION_REQUIRED' });

    const createdJob = await jobService.create({
      operatorId: input.operatorId,
      kind: 'OPENCLI_FETCH',
      entityId: session.id,
      inputVersion: input.expectedVersion,
      idempotencyKey: `review-fetch:${input.idempotencyKey}`,
      sourceSummary: {
        sourceType: 'AUTHORIZATION',
        version: authorization.version,
        capturedAt: this.now(),
        accessLimitations: LIMITATIONS,
      },
    });
    if (!createdJob.created) return createdJob;

    const fetching = await this.repositories.workflowSessions.updateStatus(session.id, {
      expectedVersion: session.currentVersion,
      status: 'FETCHING_OPENCLI',
      currentVersion: input.expectedVersion,
    });
    if (isConflict(fetching)) throw new PublicApplicationError({ code: 'VERSION_CONFLICT', currentVersion: fetching.actualVersion });

    await jobService.start(createdJob.job.id);
    try {
      const result = await gateway.fetch({
        reviewId: session.id,
        authorizationId: authorization.id,
        exactNoteUrl: exactNoteUrl.normalized,
      });
      if (result.kind === 'failure') {
        await this.finishFetchFailure({
          session,
          authorization,
          jobId: createdJob.job.id,
          result,
          operatorId: input.operatorId,
          traceId: input.traceId,
        });
        return { job: (await this.repositories.jobs.getById(createdJob.job.id)) ?? createdJob.job, created: true };
      }
      const source = await this.sources.createAndLink({
        record: {
          sourceType: 'OPENCLI_CONTENT',
          sourceRef: `opencli-fetch:${createdJob.job.id}`,
          version: 1,
          contentHash: hash(result.content),
          capturedAt: result.content.retrievedAt,
          operatorId: input.operatorId,
          parentSourceRecordIds: [urlSource.id],
          accessLimitations: [...LIMITATIONS, ...result.content.platformLimitations],
          redactionStatus: 'REDACTED',
        },
        link: { entityType: 'WORKFLOW_SESSION', entityId: session.id, role: 'OPENCLI_CONTENT' },
      });
      const content = await this.repositories.accessibleContents.create({
        ...result.content,
        rawHash: hash(result.content),
        sourceRecordId: source.id,
      });
      await this.sources.link({ sourceRecordId: source.id, entityType: 'ACCESSIBLE_CONTENT', entityId: content.id, role: 'CONTENT' });
      await this.audits.append({
        actorType: 'OPENCLI',
        actorId: input.operatorId,
        action: 'ACCESS',
        entityType: 'ACCESSIBLE_CONTENT',
        entityId: content.id,
        resultStatus: 'CONTENT_READY',
        sourceRecordId: source.id,
        toolId: authorization.toolId,
        traceId: input.traceId,
      });
      const ready = await this.repositories.workflowSessions.updateStatus(session.id, {
        expectedVersion: (fetching as WorkflowSession).currentVersion,
        status: 'CONTENT_READY',
        currentVersion: input.expectedVersion,
      });
      if (isConflict(ready)) throw new PublicApplicationError({ code: 'VERSION_CONFLICT', currentVersion: ready.actualVersion });
      await jobService.succeed({ jobId: createdJob.job.id, sourceRecordId: source.id });
      await this.completeByKey(input.operatorId, input.idempotencyKey, session.id, input.expectedVersion);
      return { job: (await this.repositories.jobs.getById(createdJob.job.id)) ?? createdJob.job, created: true };
    } catch (error) {
      const failureCode =
        error instanceof PublicApplicationError
          ? error.code
          : 'OPENCLI_NOT_CONFIGURED';
      if (
        failureCode === 'OPENCLI_NOT_CONFIGURED' ||
        failureCode === 'OPENCLI_FORBIDDEN' ||
        failureCode === 'OPENCLI_TIMEOUT' ||
        failureCode === 'AUTHORIZATION_REQUIRED'
      ) {
        const gatewayCode =
          failureCode === 'OPENCLI_TIMEOUT'
            ? 'TIMEOUT'
            : failureCode === 'OPENCLI_FORBIDDEN'
              ? 'PLATFORM_BLOCKED'
              : failureCode === 'AUTHORIZATION_REQUIRED'
                ? 'AUTHORIZATION_REQUIRED'
                : 'TOOL_UNAVAILABLE';
        await this.finishFetchFailure({
          session,
          authorization,
          jobId: createdJob.job.id,
          result: { kind: 'failure', code: gatewayCode },
          operatorId: input.operatorId,
          traceId: input.traceId,
        });
        return {
          job: (await this.repositories.jobs.getById(createdJob.job.id)) ?? createdJob.job,
          created: true,
        };
      }
      throw error;
    }
  }

  private async finishFetchFailure(input: {
    session: WorkflowSession;
    authorization: NonNullable<Awaited<ReturnType<PersistenceRepositories['accessAuthorizations']['getValidForExactRequest']>>>;
    jobId: UUID;
    result: Extract<OpenCliFetchResult, { kind: 'failure' }>;
    operatorId: UUID;
    traceId: string;
  }): Promise<void> {
    const source = await this.sources.createAndLink({
      record: {
        sourceType: 'OPENCLI_CONTENT',
        sourceRef: `opencli-fetch:${input.jobId}:failure`,
        version: 1,
        contentHash: hash(input.result.code),
        capturedAt: this.now(),
        operatorId: input.operatorId,
        parentSourceRecordIds: [],
        accessLimitations: LIMITATIONS,
        redactionStatus: 'REDACTED',
      },
      link: { entityType: 'WORKFLOW_SESSION', entityId: input.session.id, role: 'OPENCLI_FAILURE' },
    });
    await this.audits.append({
      actorType: 'OPENCLI', actorId: input.operatorId, action: 'ACCESS', entityType: 'WORKFLOW_SESSION', entityId: input.session.id,
      resultStatus: 'ACCESS_FAILED', sourceRecordId: source.id, reason: input.result.code, toolId: input.authorization.toolId, traceId: input.traceId,
    });
    const failed = await this.repositories.workflowSessions.updateStatus(input.session.id, {
      expectedVersion: input.session.currentVersion,
      status: 'ACCESS_FAILED',
      currentVersion: input.session.currentVersion,
    });
    if (isConflict(failed)) throw new PublicApplicationError({ code: 'VERSION_CONFLICT', currentVersion: failed.actualVersion });
    const errorCode = input.result.code === 'AUTHORIZATION_REQUIRED' ? 'AUTHORIZATION_REQUIRED' : input.result.code === 'TIMEOUT' ? 'OPENCLI_TIMEOUT' : input.result.code === 'NON_PUBLIC' || input.result.code === 'PLATFORM_BLOCKED' ? 'OPENCLI_FORBIDDEN' : 'OPENCLI_NOT_CONFIGURED';
    await this.jobService!.fail({ jobId: input.jobId, failure: { code: errorCode }, sourceRecordId: source.id });
  }

  private async reviewUrlSource(reviewId: UUID) {
    const links = await this.sources.getLinksForEntity('WORKFLOW_SESSION', reviewId);
    const link = links.find((item) => item.role === 'NOTE_URL');
    return link ? this.repositories.sourceRecords.getById(link.sourceRecordId) : null;
  }

  private async completeByKey(operatorId: UUID, key: string, entityId: UUID, version: number): Promise<void> {
    const record = await this.repositories.idempotencyRecords.getByKey(`${PREFIX}${operatorId}:${key}`);
    if (record && record.status === 'IN_PROGRESS') await this.complete(record.id, entityId, version);
  }

  async appendManual(input: {
    reviewId: UUID;
    operatorId: UUID;
    request: ManualContentRequest;
    expectedVersion: number;
    idempotencyKey: string;
    traceId: string;
  }): Promise<{ review: ReviewDto; created: boolean }> {
    const session = await this.owned(input.reviewId, input.operatorId);
    const current = await this.repositories.manualContentInputs.getLatestBySession(session.id);
    const expected = input.expectedVersion;
    const fingerprint = hash({
      operatorId: input.operatorId,
      reviewId: input.reviewId,
      expected,
      request: input.request,
    });
    const claim = await this.claim(
      input.operatorId,
      input.idempotencyKey,
      fingerprint,
      'manual-content',
      input.reviewId,
      expected,
    );
    if (claim.completed)
      return {
        review: await this.get({ reviewId: input.reviewId, operatorId: input.operatorId }),
        created: false,
      };
    if ((current?.version ?? 0) !== expected)
      throw new PublicApplicationError({
        code: 'VERSION_CONFLICT',
        currentVersion: current?.version ?? 0,
      });
    try {
      const manual = await this.appendManualVersion({
        session,
        operatorId: input.operatorId,
        request: input.request,
        expectedVersion: expected,
        traceId: input.traceId,
        previous: current ?? undefined,
      });
      const updated = await this.repositories.workflowSessions.updateStatus(session.id, {
        expectedVersion: session.currentVersion,
        status: 'MANUAL_INPUT',
        currentVersion: manual.version,
      });
      if (isConflict(updated))
        throw new PublicApplicationError({
          code: 'VERSION_CONFLICT',
          currentVersion: updated.actualVersion,
        });
      await this.complete(claim.recordId, manual.id, manual.version);
      return { review: this.toDto(updated as WorkflowSession, undefined, manual), created: true };
    } catch (error) {
      if (error instanceof PersistenceVersionConflictError) throw conflict(error);
      throw error;
    }
  }

  private async appendManualVersion(input: {
    session: WorkflowSession;
    operatorId: UUID;
    request: ManualContentRequest;
    expectedVersion: number;
    traceId: string;
    previous?: ManualContentInput;
  }): Promise<ManualContentInput> {
    const source = await this.sources.create({
      sourceType: 'MANUAL_INPUT',
      sourceRef: `manual-content:${input.session.id}:v${input.expectedVersion + 1}`,
      version: input.expectedVersion + 1,
      contentHash: hash(input.request),
      capturedAt: this.now(),
      operatorId: input.operatorId,
      parentSourceRecordIds: input.previous ? [input.previous.sourceRecordId] : [],
      accessLimitations: ['内容和指标由 Operator 人工提供，缺失值不会被推断'],
      redactionStatus: 'NOT_REQUIRED',
    });
    const manual = await this.versions.append({
      repository: this.repositories.manualContentInputs,
      sessionId: input.session.id,
      expectedVersion: input.expectedVersion,
      input: {
        reviewId: input.session.id,
        title: input.request.title,
        body: input.request.body,
        coverDescription: input.request.coverDescription,
        metricValues: input.request.metricValues,
        sourceRecordId: source.id,
        contentHash: hash(input.request),
        editedBy: input.operatorId,
        editReason: input.request.editReason,
      },
    });
    await this.sources.link({
      sourceRecordId: source.id,
      entityType: 'MANUAL_CONTENT_INPUT',
      entityId: manual.id,
      role: 'MANUAL_INPUT',
    });
    await this.audits.append({
      actorType: 'OPERATOR',
      actorId: input.operatorId,
      action: input.previous ? 'MANUAL_EDIT' : 'FALLBACK',
      entityType: 'MANUAL_CONTENT_INPUT',
      entityId: manual.id,
      beforeHash: input.previous?.contentHash,
      afterHash: manual.contentHash,
      reason: input.request.editReason,
      resultStatus: 'CREATED',
      sourceRecordId: source.id,
      traceId: input.traceId,
    });
    return manual;
  }

  private async owned(reviewId: UUID, operatorId: UUID): Promise<WorkflowSession> {
    const session = await this.repositories.workflowSessions.getById(reviewId);
    if (!session || session.operatorId !== operatorId || session.kind !== 'REVIEWER')
      throw notFound();
    return session;
  }
  private toDto(
    session: WorkflowSession,
    noteUrl?: { raw: string; normalized: string },
    manual?: ManualContentInput,
  ): ReviewDto {
    return {
      id: session.id,
      operatorId: session.operatorId,
      kind: session.kind,
      status: session.status,
      currentVersion: session.currentVersion,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      ...(noteUrl ? { noteUrl } : {}),
      ...(manual
        ? {
            manualContent: {
              id: manual.id,
              version: manual.version,
              ...(manual.title ? { title: manual.title } : {}),
              ...(manual.body ? { body: manual.body } : {}),
              ...(manual.coverDescription ? { coverDescription: manual.coverDescription } : {}),
              metricValues: manual.metricValues,
              sourceRecordId: manual.sourceRecordId,
              contentHash: manual.contentHash,
              createdAt: manual.createdAt.toISOString(),
            },
          }
        : {}),
      limitations: LIMITATIONS,
    };
  }

  private async claim(
    operatorId: UUID,
    key: string,
    requestHash: string,
    operation: string,
    entityId: UUID,
    inputVersion: number,
  ): Promise<{ recordId: UUID; completed: boolean; resultEntityId?: UUID }> {
    const idempotencyKey = `${PREFIX}${operatorId}:${key}`;
    const step = `${operation}:${requestHash}`;
    const existing = await this.repositories.idempotencyRecords.getByKey(idempotencyKey);
    if (existing) {
      if (
        existing.jobId !== operatorId ||
        existing.step !== step ||
        existing.entityId !== entityId ||
        existing.inputVersion !== inputVersion
      )
        throw new PublicApplicationError({
          code: 'REQUEST_INVALID',
          fieldErrors: {
            idempotencyKey: ['This key is already associated with different inputs.'],
          },
        });
      return {
        recordId: existing.id,
        completed: existing.status === 'COMPLETED',
        resultEntityId: existing.resultEntityId,
      };
    }
    try {
      const record = await this.repositories.idempotencyRecords.create({
        idempotencyKey,
        jobId: operatorId,
        inputVersion,
        step,
        entityId,
        status: 'IN_PROGRESS',
        version: 1,
      });
      return { recordId: record.id, completed: false };
    } catch {
      throw new PublicApplicationError({
        code: 'REQUEST_INVALID',
        fieldErrors: { idempotencyKey: ['Unable to claim this request.'] },
      });
    }
  }
  private async complete(recordId: UUID, entityId: UUID, version: number): Promise<void> {
    const result = await this.repositories.idempotencyRecords.complete(recordId, {
      expectedVersion: 1,
      resultEntityId: entityId,
      resultVersion: version,
      completedAt: this.now(),
    });
    if (isConflict(result))
      throw new PublicApplicationError({
        code: 'VERSION_CONFLICT',
        currentVersion: result.actualVersion,
      });
  }
}
