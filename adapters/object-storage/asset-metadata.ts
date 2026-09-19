import 'server-only';

import type { CoverAsset, SupplementaryFile, UUID } from '../../domain/persistence/models';
import type { ReadPrivateObject, StoredPrivateObject } from './private-object-storage';

export type SupplementaryFileMetadataInput = Omit<
  SupplementaryFile,
  'id' | 'createdAt' | 'createdBy'
>;

export type CoverAssetMetadataInput = Omit<CoverAsset, 'id' | 'createdAt' | 'createdBy'>;

function assertScope(
  object: StoredPrivateObject | ReadPrivateObject,
  expectedScope: StoredPrivateObject['scope'],
): void {
  if (object.scope !== expectedScope) {
    throw new Error(`Expected a ${expectedScope} object, received ${object.scope}`);
  }
}

export function createSupplementaryFileMetadata(input: {
  readonly sessionId: UUID;
  readonly originalFilename: string;
  readonly version: number;
  readonly parseStatus: SupplementaryFile['parseStatus'];
  readonly parseErrorCode?: string;
  readonly sourceRecordId: UUID;
  readonly parseSourceRecordId?: UUID;
  readonly parsedContent?: string;
  readonly parsedContentHash?: string;
  readonly contentSourceRecordId?: UUID;
  readonly boundBriefVersion?: number;
  readonly manualAction?: SupplementaryFile['manualAction'];
  readonly manualActionSourceRecordId?: UUID;
  readonly object: StoredPrivateObject | ReadPrivateObject;
}): SupplementaryFileMetadataInput {
  assertScope(input.object, 'supplementary-file');
  return {
    sessionId: input.sessionId,
    objectKey: input.object.objectKey,
    originalFilename: input.originalFilename,
    mimeType: input.object.mimeType,
    sizeBytes: input.object.sizeBytes,
    sha256: input.object.sha256,
    version: input.version,
    parseStatus: input.parseStatus,
    parseErrorCode: input.parseErrorCode,
    sourceRecordId: input.sourceRecordId,
    ...(input.parseSourceRecordId ? { parseSourceRecordId: input.parseSourceRecordId } : {}),
    ...(input.parsedContent !== undefined ? { parsedContent: input.parsedContent } : {}),
    ...(input.parsedContentHash ? { parsedContentHash: input.parsedContentHash } : {}),
    ...(input.contentSourceRecordId ? { contentSourceRecordId: input.contentSourceRecordId } : {}),
    ...(input.boundBriefVersion !== undefined ? { boundBriefVersion: input.boundBriefVersion } : {}),
    ...(input.manualAction ? { manualAction: input.manualAction } : {}),
    ...(input.manualActionSourceRecordId ? { manualActionSourceRecordId: input.manualActionSourceRecordId } : {}),
  };
}

export function assertCoverImageDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Cover image dimensions must be positive integers');
  }
  if (width * 4 !== height * 3) {
    throw new Error('Cover image must use an exact 3:4 aspect ratio');
  }
}

export function createCoverAssetMetadata(input: {
  readonly sessionId: UUID;
  readonly coverBriefVersionId: UUID;
  readonly width: number;
  readonly height: number;
  readonly origin: CoverAsset['origin'];
  readonly sourceRecordIds: readonly UUID[];
  readonly object: StoredPrivateObject | ReadPrivateObject;
  readonly status?: Extract<CoverAsset['status'], 'READY' | 'REPLACEMENT'>;
  readonly generatedAt?: Date;
  readonly editVersion?: number;
}): CoverAssetMetadataInput {
  assertScope(input.object, 'cover-image');
  assertCoverImageDimensions(input.width, input.height);
  return {
    sessionId: input.sessionId,
    coverBriefVersionId: input.coverBriefVersionId,
    objectKey: input.object.objectKey,
    mimeType: input.object.mimeType,
    width: input.width,
    height: input.height,
    aspectRatio: '3:4',
    pixelHash: input.object.sha256,
    version: 1,
    status: input.status ?? 'READY',
    origin: input.origin,
    generatedAt: input.generatedAt,
    editVersion: input.editVersion ?? 0,
    sourceRecordIds: [...input.sourceRecordIds],
  };
}

export function metadataContainsObjectBytes(value: object): boolean {
  return Object.prototype.hasOwnProperty.call(value, 'bytes');
}
