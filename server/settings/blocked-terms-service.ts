import { createHash } from 'node:crypto';

import type { BlockedTermListVersion, JsonObject, UUID } from '@/domain/persistence/models';
import type { PersistenceRepositories } from '@/domain/persistence/repositories';
import {
  ImmutableVersionService,
  PersistenceVersionConflictError,
} from '@/domain/persistence/services';
import { PublicApplicationError } from '@/server/public-errors';
import type { BlockedTermListCreateInput, BlockedTermListPatchInput } from './blocked-terms-schema';

export type BlockedTermListDto = Readonly<{
  readonly id: UUID;
  readonly operatorId: UUID;
  readonly name: string;
  readonly version: number;
  readonly terms: readonly string[];
  readonly normalizationPolicy: JsonObject;
  readonly status: BlockedTermListVersion['status'];
  readonly importedFrom?: string;
  readonly contentHash: string;
  readonly createdAt: string;
  readonly editedBy?: UUID;
  readonly editReason?: string;
}>;

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
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

function listVersionError(input: {
  readonly expected: number | undefined;
  readonly actual: number;
}): PublicApplicationError {
  return new PublicApplicationError({
    code: 'VERSION_CONFLICT',
    currentVersion: input.actual,
    fieldErrors:
      input.expected === undefined
        ? { expectedVersion: ['The x-expected-version header is required.'] }
        : undefined,
  });
}

export class BlockedTermListService {
  private readonly versions = new ImmutableVersionService();

  constructor(private readonly repositories: PersistenceRepositories) {}

  async list(input: {
    readonly operatorId: UUID;
    readonly name?: string;
  }): Promise<{ readonly items: readonly BlockedTermListDto[] }> {
    const page = await this.repositories.blockedTermLists.listByOperator(input.operatorId, {
      limit: 1_000,
    });
    const items = page.items
      .filter((item) => !input.name || item.name === input.name)
      .map((item) => this.toDto(item));
    return { items };
  }

  async get(input: { readonly operatorId: UUID; readonly id: UUID }): Promise<BlockedTermListDto> {
    const record = await this.repositories.blockedTermLists.getById(input.id);
    if (!record || record.operatorId !== input.operatorId) throw notFound();
    return this.toDto(record);
  }

  async create(input: {
    readonly operatorId: UUID;
    readonly request: BlockedTermListCreateInput;
    readonly traceId: string;
    readonly idempotencyKey: string;
  }): Promise<{ readonly list: BlockedTermListDto; readonly created: boolean }> {
    const existing = await this.findIdempotent(input.operatorId, input.idempotencyKey);
    if (existing) return { list: this.toDto(existing), created: false };
    const record = await this.repositories.blockedTermLists.create(
      this.newVersion(input.operatorId, input.request, 1),
    );
    await this.saveIdempotency(input, record);
    return { list: this.toDto(record), created: true };
  }

  async update(input: {
    readonly operatorId: UUID;
    readonly request: BlockedTermListPatchInput;
    readonly expectedVersion: number;
    readonly traceId: string;
    readonly idempotencyKey: string;
  }): Promise<{ readonly list: BlockedTermListDto; readonly created: boolean }> {
    const current = await this.repositories.blockedTermLists.getById(input.request.id);
    if (!current || current.operatorId !== input.operatorId || current.status === 'ARCHIVED')
      throw notFound();
    if (current.version !== input.expectedVersion)
      throw listVersionError({ expected: input.expectedVersion, actual: current.version });
    const existing = await this.findIdempotent(input.operatorId, input.idempotencyKey);
    if (existing) return { list: this.toDto(existing), created: false };
    try {
      const record = await this.repositories.blockedTermLists.create(
        this.newVersion(
          input.operatorId,
          {
            name: input.request.name ?? current.name,
            terms: input.request.terms ?? current.terms,
            normalizationPolicy: input.request.normalizationPolicy ?? current.normalizationPolicy,
            ...(input.request.importedFrom !== undefined
              ? { importedFrom: input.request.importedFrom }
              : current.importedFrom
                ? { importedFrom: current.importedFrom }
                : {}),
            editReason: input.request.editReason,
          },
          current.version + 1,
        ),
      );
      await this.repositories.blockedTermLists.archive(current.id);
      await this.saveIdempotency(input, record);
      return { list: this.toDto(record), created: true };
    } catch (error) {
      if (error instanceof PersistenceVersionConflictError) throw conflict(error);
      throw error;
    }
  }

  async archive(input: {
    readonly operatorId: UUID;
    readonly id: UUID;
    readonly expectedVersion: number;
    readonly idempotencyKey: string;
    readonly traceId: string;
  }): Promise<{ readonly list: BlockedTermListDto; readonly created: boolean }> {
    const current = await this.repositories.blockedTermLists.getById(input.id);
    if (!current || current.operatorId !== input.operatorId) throw notFound();
    if (current.version !== input.expectedVersion)
      throw listVersionError({ expected: input.expectedVersion, actual: current.version });
    const existing = await this.findIdempotent(input.operatorId, input.idempotencyKey);
    if (existing) return { list: this.toDto(existing), created: false };
    const archived = await this.repositories.blockedTermLists.archive(current.id);
    if (!archived) throw notFound();
    await this.saveIdempotency(input, archived);
    return { list: this.toDto(archived), created: true };
  }

  private newVersion(operatorId: UUID, request: BlockedTermListCreateInput, version: number) {
    const terms = [
      ...new Set(request.terms.map((term) => term.normalize('NFKC').trim()).filter(Boolean)),
    ];
    return {
      operatorId,
      name: request.name.trim(),
      terms,
      normalizationPolicy: request.normalizationPolicy ?? {
        form: 'NFKC',
        trim: true,
        caseFold: false,
      },
      status: 'ACTIVE' as const,
      ...(request.importedFrom ? { importedFrom: request.importedFrom } : {}),
      contentHash: hash({
        name: request.name.trim(),
        terms,
        normalizationPolicy: request.normalizationPolicy ?? {},
      }),
      version,
      ...(request.editReason ? { editReason: request.editReason, editedBy: operatorId } : {}),
    };
  }

  private toDto(record: BlockedTermListVersion): BlockedTermListDto {
    return {
      id: record.id,
      operatorId: record.operatorId,
      name: record.name,
      version: record.version,
      terms: record.terms,
      normalizationPolicy: record.normalizationPolicy,
      status: record.status,
      ...(record.importedFrom ? { importedFrom: record.importedFrom } : {}),
      contentHash: record.contentHash,
      createdAt: record.createdAt.toISOString(),
      ...(record.editedBy ? { editedBy: record.editedBy } : {}),
      ...(record.editReason ? { editReason: record.editReason } : {}),
    };
  }

  private async findIdempotent(
    operatorId: UUID,
    key: string,
  ): Promise<BlockedTermListVersion | null> {
    const record = await this.repositories.idempotencyRecords.getByKey(
      `blocked-terms:${operatorId}:${key}`,
    );
    if (!record?.resultEntityId || record.status !== 'COMPLETED') return null;
    const result = await this.repositories.blockedTermLists.getById(record.resultEntityId);
    return result?.operatorId === operatorId ? result : null;
  }

  private async saveIdempotency(
    input: { readonly operatorId: UUID; readonly idempotencyKey: string; readonly traceId: string },
    record: BlockedTermListVersion,
  ): Promise<void> {
    const key = `blocked-terms:${input.operatorId}:${input.idempotencyKey}`;
    const existing = await this.repositories.idempotencyRecords.getByKey(key);
    if (existing) return;
    const created = await this.repositories.idempotencyRecords.create({
      idempotencyKey: key,
      jobId: input.operatorId,
      inputVersion: record.version,
      step: 'blocked-term-list',
      entityId: record.id,
      status: 'IN_PROGRESS',
      version: 1,
    });
    await this.repositories.idempotencyRecords.complete(created.id, {
      expectedVersion: 1,
      resultEntityId: record.id,
      resultVersion: record.version,
    });
  }
}
