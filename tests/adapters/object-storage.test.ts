import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type {
  CoverAssetRepository,
  SupplementaryFileRepository,
} from '../../domain/persistence/repositories';
import { AssetStorageService } from '../../adapters/object-storage/asset-storage-service';
import {
  assertCoverImageDimensions,
  createCoverAssetMetadata,
  createSupplementaryFileMetadata,
  metadataContainsObjectBytes,
} from '../../adapters/object-storage/asset-metadata';
import {
  OBJECT_STORAGE_NAMESPACE,
  PrivateObjectStorageAdapter,
  type ObjectStorageProvider,
  type ProviderObjectEntry,
} from '../../adapters/object-storage/private-object-storage';

type StoredProviderObject = {
  bytes: Uint8Array;
  contentType: string;
  metadata: Readonly<Record<string, string>>;
  lastModified: Date;
  archivedAt?: Date;
};

class InMemoryObjectStorageProvider implements ObjectStorageProvider {
  readonly objects = new Map<string, StoredProviderObject>();
  readonly archivedKeys: string[] = [];
  readonly deletedKeys: string[] = [];

  async putPrivate(input: {
    readonly objectKey: string;
    readonly bytes: Uint8Array;
    readonly contentType: string;
    readonly metadata: Readonly<Record<string, string>>;
  }): Promise<void> {
    this.objects.set(input.objectKey, {
      bytes: new Uint8Array(input.bytes),
      contentType: input.contentType,
      metadata: input.metadata,
      lastModified: new Date(),
    });
  }

  async readPrivate(objectKey: string): Promise<StoredProviderObject | null> {
    const object = this.objects.get(objectKey);
    return object
      ? {
          ...object,
          bytes: new Uint8Array(object.bytes),
        }
      : null;
  }

  async archivePrivate(objectKey: string): Promise<void> {
    const object = this.objects.get(objectKey);
    if (object) {
      object.archivedAt = new Date();
      this.archivedKeys.push(objectKey);
    }
  }

  async deletePrivate(objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
    this.deletedKeys.push(objectKey);
  }

  async listPrivate(input: { readonly prefix: string }): Promise<readonly ProviderObjectEntry[]> {
    return [...this.objects.entries()]
      .filter(([objectKey]) => objectKey.startsWith(input.prefix))
      .map(([objectKey, object]) => ({
        objectKey,
        contentType: object.contentType,
        metadata: object.metadata,
        sizeBytes: object.bytes.byteLength,
        lastModified: object.lastModified,
        archivedAt: object.archivedAt,
      }));
  }
}

const sessionId = 'session-123';
const sourceRecordId = 'source-123';

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('private object storage adapter', () => {
  it('uploads private objects with isolated keys, SHA-256 metadata, and no caller metadata', async () => {
    const provider = new InMemoryObjectStorageProvider();
    const storage = new PrivateObjectStorageAdapter(provider);
    const bytes = new Uint8Array([1, 2, 3, 4]);

    const stored = await storage.uploadPrivate({
      scope: 'supplementary-file',
      sessionId,
      objectId: 'object-123',
      bytes,
      mimeType: 'TEXT/PLAIN',
    });

    expect(stored).toMatchObject({
      objectKey: `${OBJECT_STORAGE_NAMESPACE}/supplementary-file/${sessionId}/object-123`,
      scope: 'supplementary-file',
      sessionId,
      objectId: 'object-123',
      mimeType: 'text/plain',
      sizeBytes: 4,
      sha256: hash(bytes),
      visibility: 'private',
    });
    const providerObject = provider.objects.get(stored.objectKey);
    expect(providerObject?.metadata).toEqual({
      'x-team-tj-visibility': 'private',
      'x-team-tj-scope': 'supplementary-file',
      'x-team-tj-content-type': 'text/plain',
      'x-team-tj-content-size': '4',
      'x-team-tj-sha256': hash(bytes),
    });
    expect(JSON.stringify(providerObject?.metadata)).not.toMatch(
      /credential|cookie|token|authorization|secret/i,
    );
  });

  it('reads private objects with verified hash metadata and returns a byte copy', async () => {
    const provider = new InMemoryObjectStorageProvider();
    const storage = new PrivateObjectStorageAdapter(provider);
    const original = new Uint8Array([7, 8, 9]);
    const stored = await storage.uploadPrivate({
      scope: 'cover-image',
      sessionId,
      objectId: 'cover-123',
      bytes: original,
      mimeType: 'image/png',
    });

    const read = await storage.readPrivate(stored.objectKey);
    read.bytes[0] = 99;
    const reread = await storage.readPrivate(stored.objectKey);

    expect([...reread.bytes]).toEqual([...original]);
    expect(read.sha256).toBe(hash(original));
    expect(read.visibility).toBe('private');
  });

  it('rejects unsupported MIME types, oversized payloads, mismatched hashes, and unsafe keys', async () => {
    const provider = new InMemoryObjectStorageProvider();
    const storage = new PrivateObjectStorageAdapter(provider, {
      policies: {
        'supplementary-file': {
          scope: 'supplementary-file',
          maxBytes: 3,
          allowedMimeTypes: ['text/plain'],
        },
        'cover-image': {
          scope: 'cover-image',
          maxBytes: 3,
          allowedMimeTypes: ['image/png'],
        },
      },
    });

    await expect(
      storage.uploadPrivate({
        scope: 'supplementary-file',
        sessionId,
        objectId: 'bad-type',
        bytes: new Uint8Array([1]),
        mimeType: 'application/zip',
      }),
    ).rejects.toThrow('MIME type is not allowed');
    await expect(
      storage.uploadPrivate({
        scope: 'supplementary-file',
        sessionId,
        objectId: 'too-large',
        bytes: new Uint8Array([1, 2, 3, 4]),
        mimeType: 'text/plain',
      }),
    ).rejects.toThrow('size limit');
    await expect(
      storage.uploadPrivate({
        scope: 'supplementary-file',
        sessionId,
        objectId: 'wrong-hash',
        bytes: new Uint8Array([1]),
        mimeType: 'text/plain',
        expectedSha256: '0'.repeat(64),
      }),
    ).rejects.toThrow('does not match');
    await expect(
      storage.uploadPrivate({
        scope: 'supplementary-file',
        sessionId: '../other-session',
        objectId: 'unsafe',
        bytes: new Uint8Array([1]),
        mimeType: 'text/plain',
      }),
    ).rejects.toThrow('invalid object-key segment');
    await expect(storage.readPrivate('team-tj/public/file')).rejects.toThrow(
      'outside the private Team-TJ namespace',
    );
  });

  it('archives or deletes only unreferenced stale objects and retains audit hashes', async () => {
    const provider = new InMemoryObjectStorageProvider();
    const cleaned: string[] = [];
    const storage = new PrivateObjectStorageAdapter(provider, {
      hooks: {
        onOrphanCleaned: (object, action) => {
          cleaned.push(`${action}:${object.sha256}`);
        },
      },
    });
    const stale = await storage.uploadPrivate({
      scope: 'supplementary-file',
      sessionId,
      objectId: 'stale',
      bytes: new Uint8Array([1]),
      mimeType: 'text/plain',
    });
    const referenced = await storage.uploadPrivate({
      scope: 'supplementary-file',
      sessionId,
      objectId: 'referenced',
      bytes: new Uint8Array([2]),
      mimeType: 'text/plain',
    });
    const staleProviderObject = provider.objects.get(stale.objectKey);
    if (!staleProviderObject) throw new Error('stale object was not stored');
    staleProviderObject.lastModified = new Date(Date.now() - 60_000);

    const oldEnough = new Date(Date.now() - 30_000);
    const orphans = await storage.listOrphans({
      scope: 'supplementary-file',
      olderThan: oldEnough,
      referencedObjectKeys: new Set([referenced.objectKey]),
    });
    expect(orphans.map((object) => object.objectKey)).toEqual([stale.objectKey]);

    const result = await storage.cleanupOrphans({
      scope: 'supplementary-file',
      olderThan: oldEnough,
      referencedObjectKeys: new Set([referenced.objectKey]),
      mode: 'delete',
    });
    expect(result).toEqual({
      inspected: 1,
      cleaned: 1,
      retainedAuditHashes: [{ objectKey: stale.objectKey, sha256: stale.sha256, action: 'delete' }],
    });
    expect(provider.deletedKeys).toEqual([stale.objectKey]);
    expect(provider.objects.has(referenced.objectKey)).toBe(true);
    expect(cleaned).toEqual([`delete:${stale.sha256}`]);
  });
});

describe('file and cover metadata flow', () => {
  it('maps supplementary file storage output to database metadata without bytes', async () => {
    const provider = new InMemoryObjectStorageProvider();
    const storage = new PrivateObjectStorageAdapter(provider);
    const stored = await storage.uploadPrivate({
      scope: 'supplementary-file',
      sessionId,
      objectId: 'file-123',
      bytes: new Uint8Array([11, 12]),
      mimeType: 'text/plain',
    });

    const metadata = createSupplementaryFileMetadata({
      sessionId,
      originalFilename: 'brief.txt',
      version: 1,
      parseStatus: 'PENDING',
      sourceRecordId,
      object: stored,
    });

    expect(metadata).toEqual({
      sessionId,
      objectKey: stored.objectKey,
      originalFilename: 'brief.txt',
      mimeType: 'text/plain',
      sizeBytes: 2,
      sha256: stored.sha256,
      version: 1,
      parseStatus: 'PENDING',
      parseErrorCode: undefined,
      sourceRecordId,
    });
    expect(metadataContainsObjectBytes(metadata)).toBe(false);
  });

  it('maps cover storage output to 3:4 metadata and rejects a non-3:4 result', async () => {
    const provider = new InMemoryObjectStorageProvider();
    const storage = new PrivateObjectStorageAdapter(provider);
    const stored = await storage.uploadPrivate({
      scope: 'cover-image',
      sessionId,
      objectId: 'cover-123',
      bytes: new Uint8Array([21, 22]),
      mimeType: 'image/png',
    });

    const metadata = createCoverAssetMetadata({
      sessionId,
      coverBriefVersionId: 'brief-123',
      width: 1080,
      height: 1440,
      origin: 'OPERATOR_UPLOAD',
      sourceRecordIds: [sourceRecordId],
      object: stored,
    });

    expect(metadata).toMatchObject({
      sessionId,
      coverBriefVersionId: 'brief-123',
      objectKey: stored.objectKey,
      mimeType: 'image/png',
      width: 1080,
      height: 1440,
      aspectRatio: '3:4',
      pixelHash: stored.sha256,
      status: 'READY',
      origin: 'OPERATOR_UPLOAD',
      editVersion: 0,
    });
    expect(metadataContainsObjectBytes(metadata)).toBe(false);
    expect(() => assertCoverImageDimensions(1080, 1080)).toThrow('exact 3:4');
    expect(() =>
      createCoverAssetMetadata({
        sessionId,
        coverBriefVersionId: 'brief-123',
        width: 1080,
        height: 1440,
        origin: 'GENERATED',
        sourceRecordIds: [],
        object: { ...stored, scope: 'supplementary-file' },
      }),
    ).toThrow('Expected a cover-image object');
  });
});

describe('asset storage metadata persistence handoff', () => {
  it('persists only file metadata and archives the object if the metadata write fails', async () => {
    const provider = new InMemoryObjectStorageProvider();
    const storage = new PrivateObjectStorageAdapter(provider);
    let receivedInput: Parameters<SupplementaryFileRepository['create']>[0] | undefined;
    const supplementaryFiles = {
      create: async (input: Parameters<SupplementaryFileRepository['create']>[0]) => {
        receivedInput = input;
        return {
          ...input,
          id: 'file-record-123',
          createdAt: new Date(),
          createdBy: 'SYSTEM' as const,
        };
      },
    } as unknown as SupplementaryFileRepository;
    const coverAssets = {
      create: async (input: Parameters<CoverAssetRepository['create']>[0]) => ({
        ...input,
        id: 'cover-record-123',
        createdAt: new Date(),
        createdBy: 'SYSTEM' as const,
      }),
    } as unknown as CoverAssetRepository;
    const service = new AssetStorageService(storage, supplementaryFiles, coverAssets);

    const record = await service.storeSupplementaryFile({
      sessionId,
      originalFilename: 'source.md',
      version: 1,
      sourceRecordId,
      bytes: new Uint8Array([31, 32]),
      mimeType: 'text/markdown',
    });

    expect(record).toMatchObject({
      id: 'file-record-123',
      objectKey: expect.stringContaining('/supplementary-file/session-123/'),
      sha256: hash(new Uint8Array([31, 32])),
      sizeBytes: 2,
    });
    expect(receivedInput).toBeDefined();
    expect(receivedInput).not.toHaveProperty('bytes');
    expect(receivedInput).not.toHaveProperty('credential');
    expect(receivedInput).not.toHaveProperty('cookie');
    expect(receivedInput).not.toHaveProperty('token');
  });

  it('archives an uploaded cover when its metadata repository write fails', async () => {
    const provider = new InMemoryObjectStorageProvider();
    const storage = new PrivateObjectStorageAdapter(provider);
    const supplementaryFiles = {
      create: async () => {
        throw new Error('metadata persistence unavailable');
      },
    } as unknown as SupplementaryFileRepository;
    const coverAssets = {
      create: async () => {
        throw new Error('metadata persistence unavailable');
      },
    } as unknown as CoverAssetRepository;
    const service = new AssetStorageService(storage, supplementaryFiles, coverAssets);

    await expect(
      service.storeCoverAsset({
        sessionId,
        coverBriefVersionId: 'brief-123',
        width: 1080,
        height: 1440,
        origin: 'GENERATED',
        sourceRecordIds: [sourceRecordId],
        bytes: new Uint8Array([41, 42]),
        mimeType: 'image/png',
      }),
    ).rejects.toThrow('metadata persistence unavailable');
    expect(provider.archivedKeys).toHaveLength(1);
    expect([...provider.objects.values()][0]?.archivedAt).toBeInstanceOf(Date);
  });
});
