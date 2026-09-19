import { createHash, randomUUID } from 'node:crypto';

import type { PrivateObjectStorageAdapter } from '@/adapters/object-storage/private-object-storage';
import type {
  SourceRecord,
  SupplementaryFile,
  SupplementaryFileManualAction,
  UUID,
} from '@/domain/persistence/models';
import type { PersistenceRepositories } from '@/domain/persistence/repositories';
import { SourceRecordService } from '@/domain/persistence/services';
import { PublicApplicationError } from '@/server/public-errors';

const MAX_PARSED_CONTENT_BYTES = 200_000;
const SUPPORTED_MIME_TYPES = new Set([
  'application/pdf',
  'application/rtf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/markdown',
  'text/plain',
]);

export type SupplementaryFileDto = Readonly<{
  readonly id: UUID;
  readonly sessionId: UUID;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly version: number;
  readonly parseStatus: SupplementaryFile['parseStatus'];
  readonly sourceRecordId: UUID;
  readonly parseSourceRecordId?: UUID;
  readonly contentSourceRecordId?: UUID;
  readonly boundBriefVersion?: number;
  readonly manualAction?: SupplementaryFileManualAction;
  readonly parseErrorCode?: string;
  readonly parsedContent?: string;
  readonly createdAt: string;
}>;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function textFrom(bytes: Uint8Array, mimeType: string): string {
  if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\u0000/g, '').trim();
  }
  throw new Error('Parser is not available for this document format');
}

function boundedText(value: string): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength > MAX_PARSED_CONTENT_BYTES) {
    return new TextDecoder().decode(bytes.slice(0, MAX_PARSED_CONTENT_BYTES)).trim();
  }
  return value;
}

function unreadableCode(error: unknown): string {
  return error instanceof TypeError ? 'FILE_ENCODING_INVALID' : 'FILE_UNREADABLE';
}

function toDto(file: SupplementaryFile): SupplementaryFileDto {
  return {
    id: file.id,
    sessionId: file.sessionId,
    originalFilename: file.originalFilename,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    version: file.version,
    parseStatus: file.parseStatus,
    sourceRecordId: file.sourceRecordId,
    ...(file.parseSourceRecordId ? { parseSourceRecordId: file.parseSourceRecordId } : {}),
    ...(file.contentSourceRecordId ? { contentSourceRecordId: file.contentSourceRecordId } : {}),
    ...(file.boundBriefVersion !== undefined ? { boundBriefVersion: file.boundBriefVersion } : {}),
    ...(file.manualAction ? { manualAction: file.manualAction } : {}),
    ...(file.parseErrorCode ? { parseErrorCode: file.parseErrorCode } : {}),
    ...(file.parsedContent !== undefined ? { parsedContent: file.parsedContent } : {}),
    createdAt: file.createdAt.toISOString(),
  };
}

function notFound(): PublicApplicationError {
  return new PublicApplicationError({ code: 'JOB_NOT_FOUND' });
}

export class SupplementaryFileService {
  private readonly sources: SourceRecordService;
  private readonly now: () => Date;

  constructor(
    private readonly repositories: PersistenceRepositories,
    private readonly storage: PrivateObjectStorageAdapter,
    options: { readonly now?: () => Date } = {},
  ) {
    this.sources = new SourceRecordService(repositories.sourceRecords);
    this.now = options.now ?? (() => new Date());
  }

  async list(input: { readonly sessionId: UUID; readonly operatorId: UUID }): Promise<readonly SupplementaryFileDto[]> {
    await this.ownedSession(input.sessionId, input.operatorId);
    const page = await this.repositories.supplementaryFiles.listBySession(input.sessionId, { limit: 100 });
    return page.items.map(toDto);
  }

  async upload(input: {
    readonly sessionId: UUID;
    readonly operatorId: UUID;
    readonly file: File;
  }): Promise<SupplementaryFileDto> {
    const session = await this.ownedSession(input.sessionId, input.operatorId);
    const mimeType = input.file.type.trim().toLowerCase();
    if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
      throw new PublicApplicationError({ code: 'UNSUPPORTED_MEDIA_TYPE', fieldErrors: { file: ['Upload a supported text or document file.'] } });
    }
    const bytes = new Uint8Array(await input.file.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 5_242_880) {
      throw new PublicApplicationError({ code: 'REQUEST_BODY_TOO_LARGE', fieldErrors: { file: ['The file must be between 1 byte and 5 MB.'] } });
    }

    const source = await this.sources.create({
      sourceType: 'FILE',
      sourceRef: `upload:${input.sessionId}:${input.file.name}`,
      version: session.currentVersion,
      contentHash: sha256(bytes),
      capturedAt: this.now(),
      operatorId: input.operatorId,
      parentSourceRecordIds: [],
      accessLimitations: ['PRIVATE_OBJECT_STORAGE'],
      redactionStatus: 'NOT_REQUIRED',
    });
    const stored = await this.storage.uploadPrivate({
      scope: 'supplementary-file',
      sessionId: input.sessionId,
      objectId: randomUUID(),
      bytes,
      mimeType,
    });
    const created = await this.repositories.supplementaryFiles.create({
      sessionId: input.sessionId,
      objectKey: stored.objectKey,
      originalFilename: input.file.name,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256,
      version: 1,
      parseStatus: 'PENDING',
      sourceRecordId: source.id,
    });

    let parsedContent: string | undefined;
    let parseErrorCode: string | undefined;
    try {
      parsedContent = boundedText(textFrom(bytes, mimeType));
      if (!parsedContent) throw new Error('The file contains no readable content');
    } catch (error) {
      parseErrorCode = unreadableCode(error);
    }

    const parseSource = await this.sources.create({
      sourceType: 'FILE',
      sourceRef: `parse:${created.id}`,
      version: created.version,
      ...(parsedContent ? { contentHash: sha256(new TextEncoder().encode(parsedContent)) } : {}),
      capturedAt: this.now(),
      operatorId: input.operatorId,
      parentSourceRecordIds: [source.id],
      accessLimitations: parseErrorCode ? ['PARSER_UNAVAILABLE'] : [],
      redactionStatus: 'NOT_REQUIRED',
    });
    const currentBrief = await this.repositories.contentBriefVersions.getLatestBySession(input.sessionId);
    const updated = await this.repositories.supplementaryFiles.updateParseState(created.id, {
      expectedVersion: created.version,
      parseStatus: parsedContent ? 'READABLE' : 'UNREADABLE',
      parseErrorCode,
      parseSourceRecordId: parseSource.id,
      ...(parsedContent ? {
        parsedContent,
        parsedContentHash: sha256(new TextEncoder().encode(parsedContent)),
        contentSourceRecordId: parseSource.id,
        ...(currentBrief ? { boundBriefVersion: currentBrief.version } : {}),
      } : {}),
    });
    if ('actualVersion' in updated) throw new PublicApplicationError({ code: 'VERSION_CONFLICT', currentVersion: updated.actualVersion });
    if (parsedContent && currentBrief) {
      await this.sources.link({ sourceRecordId: parseSource.id, entityType: 'CONTENT_BRIEF_VERSION', entityId: currentBrief.id, role: 'SUPPLEMENTARY_FILE_CONTENT' });
    }
    return toDto(updated);
  }

  async action(input: {
    readonly sessionId: UUID;
    readonly operatorId: UUID;
    readonly fileId: UUID;
    readonly action: SupplementaryFileManualAction;
  }): Promise<SupplementaryFileDto> {
    await this.ownedSession(input.sessionId, input.operatorId);
    const file = await this.repositories.supplementaryFiles.getById(input.fileId);
    if (!file || file.sessionId !== input.sessionId) throw notFound();
    const source = await this.sources.create({
      sourceType: 'HUMAN_EDIT',
      sourceRef: `file-action:${file.id}:${input.action}`,
      version: file.version,
      capturedAt: this.now(),
      operatorId: input.operatorId,
      parentSourceRecordIds: [file.sourceRecordId],
      accessLimitations: [],
      redactionStatus: 'NOT_REQUIRED',
    });
    const updated = await this.repositories.supplementaryFiles.updateParseState(file.id, {
      expectedVersion: file.version,
      parseStatus: input.action === 'REPLACE_FILE' ? 'REPLACED' : file.parseStatus,
      manualAction: input.action,
      manualActionSourceRecordId: source.id,
    });
    if ('actualVersion' in updated) throw new PublicApplicationError({ code: 'VERSION_CONFLICT', currentVersion: updated.actualVersion });
    return toDto(updated);
  }

  private async ownedSession(sessionId: UUID, operatorId: UUID) {
    const session = await this.repositories.workflowSessions.getById(sessionId);
    if (!session || session.operatorId !== operatorId || session.kind !== 'COPYWRITER') throw notFound();
    return session;
  }
}
