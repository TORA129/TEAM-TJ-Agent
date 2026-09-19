import 'server-only';

import { randomUUID } from 'node:crypto';

import type { CoverAsset, SupplementaryFile, UUID } from '../../domain/persistence/models';
import type {
  CoverAssetRepository,
  SupplementaryFileRepository,
} from '../../domain/persistence/repositories';
import {
  toSafeInfrastructureError,
} from '../../domain/security/redaction';
import {
  assertCoverImageDimensions,
  createCoverAssetMetadata,
  createSupplementaryFileMetadata,
} from './asset-metadata';
import type { ObjectStorageScope, PrivateObjectStorageAdapter } from './private-object-storage';

function archiveAfterMetadataFailure(
  storage: PrivateObjectStorageAdapter,
  objectKey: string,
): Promise<void> {
  return storage.archivePrivate(objectKey).catch(() => undefined);
}

export class AssetStorageService {
  constructor(
    private readonly storage: PrivateObjectStorageAdapter,
    private readonly supplementaryFiles: SupplementaryFileRepository,
    private readonly coverAssets: CoverAssetRepository,
  ) {}

  async storeSupplementaryFile(input: {
    readonly sessionId: UUID;
    readonly originalFilename: string;
    readonly version: number;
    readonly parseStatus?: SupplementaryFile['parseStatus'];
    readonly parseErrorCode?: string;
    readonly sourceRecordId: UUID;
    readonly bytes: Uint8Array;
    readonly mimeType: string;
    readonly expectedSha256?: string;
  }): Promise<SupplementaryFile> {
    const object = await this.storage.uploadPrivate({
      scope: 'supplementary-file',
      sessionId: input.sessionId,
      objectId: randomUUID(),
      bytes: input.bytes,
      mimeType: input.mimeType,
      expectedSha256: input.expectedSha256,
    });

    try {
      return await this.supplementaryFiles.create(
        createSupplementaryFileMetadata({
          sessionId: input.sessionId,
          originalFilename: input.originalFilename,
          version: input.version,
          parseStatus: input.parseStatus ?? 'PENDING',
          parseErrorCode: input.parseErrorCode,
          sourceRecordId: input.sourceRecordId,
          object,
        }),
      );
    } catch (error) {
      await archiveAfterMetadataFailure(this.storage, object.objectKey);
      throw toSafeInfrastructureError(error, 'Metadata persistence failed.');
    }
  }

  async storeCoverAsset(input: {
    readonly sessionId: UUID;
    readonly coverBriefVersionId: UUID;
    readonly width: number;
    readonly height: number;
    readonly origin: CoverAsset['origin'];
    readonly sourceRecordIds: readonly UUID[];
    readonly bytes: Uint8Array;
    readonly mimeType: string;
    readonly expectedSha256?: string;
    readonly generatedAt?: Date;
    readonly editVersion?: number;
    readonly status?: Extract<CoverAsset['status'], 'READY' | 'REPLACEMENT'>;
  }): Promise<CoverAsset> {
    assertCoverImageDimensions(input.width, input.height);
    const object = await this.storage.uploadPrivate({
      scope: 'cover-image',
      sessionId: input.sessionId,
      objectId: randomUUID(),
      bytes: input.bytes,
      mimeType: input.mimeType,
      expectedSha256: input.expectedSha256,
    });

    try {
      return await this.coverAssets.create(
        createCoverAssetMetadata({
          sessionId: input.sessionId,
          coverBriefVersionId: input.coverBriefVersionId,
          width: input.width,
          height: input.height,
          origin: input.origin,
          sourceRecordIds: input.sourceRecordIds,
          object,
          generatedAt: input.generatedAt,
          editVersion: input.editVersion,
          status: input.status,
        }),
      );
    } catch (error) {
      await archiveAfterMetadataFailure(this.storage, object.objectKey);
      throw toSafeInfrastructureError(error, 'Metadata persistence failed.');
    }
  }

  static readonly scopes: readonly ObjectStorageScope[] = ['supplementary-file', 'cover-image'];
}
