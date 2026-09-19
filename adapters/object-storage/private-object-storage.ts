import 'server-only';

import { createHash } from 'node:crypto';

import { toSafeInfrastructureError } from '../../domain/security/redaction';

export const OBJECT_STORAGE_NAMESPACE = 'team-tj/private';

export type ObjectStorageScope = 'supplementary-file' | 'cover-image';

export type ObjectStoragePolicy = {
  readonly scope: ObjectStorageScope;
  readonly maxBytes: number;
  readonly allowedMimeTypes: readonly string[];
};

export const DEFAULT_OBJECT_STORAGE_POLICIES: Readonly<
  Record<ObjectStorageScope, ObjectStoragePolicy>
> = {
  'supplementary-file': {
    scope: 'supplementary-file',
    maxBytes: 10 * 1024 * 1024,
    allowedMimeTypes: [
      'application/pdf',
      'application/rtf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/markdown',
      'text/plain',
    ],
  },
  'cover-image': {
    scope: 'cover-image',
    maxBytes: 10 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
};

type ProviderObject = {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly lastModified: Date;
  readonly archivedAt?: Date;
};

export interface ObjectStorageProvider {
  putPrivate(input: {
    readonly objectKey: string;
    readonly bytes: Uint8Array;
    readonly contentType: string;
    readonly metadata: Readonly<Record<string, string>>;
  }): Promise<void>;
  readPrivate(objectKey: string): Promise<ProviderObject | null>;
  archivePrivate(objectKey: string): Promise<void>;
  deletePrivate(objectKey: string): Promise<void>;
  listPrivate(input: { readonly prefix: string }): Promise<readonly ProviderObjectEntry[]>;
}

export type ProviderObjectEntry = {
  readonly objectKey: string;
  readonly contentType: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly sizeBytes: number;
  readonly lastModified: Date;
  readonly archivedAt?: Date;
};

export type StoredPrivateObject = {
  readonly objectKey: string;
  readonly scope: ObjectStorageScope;
  readonly sessionId: string;
  readonly objectId: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly visibility: 'private';
  readonly storedAt: Date;
};

export type ReadPrivateObject = StoredPrivateObject & {
  readonly bytes: Uint8Array;
};

export type OrphanedObject = StoredPrivateObject & {
  readonly lastModified: Date;
  readonly archivedAt?: Date;
};

export type OrphanCleanupMode = 'archive' | 'delete';

export type OrphanCleanupResult = {
  readonly inspected: number;
  readonly cleaned: number;
  readonly retainedAuditHashes: readonly {
    readonly objectKey: string;
    readonly sha256: string;
    readonly action: OrphanCleanupMode;
  }[];
};

export interface ObjectStorageLifecycleHooks {
  onOrphanCleaned?(object: OrphanedObject, action: OrphanCleanupMode): Promise<void> | void;
}

export class ObjectStorageValidationError extends Error {
  readonly code = 'OBJECT_STORAGE_VALIDATION_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'ObjectStorageValidationError';
  }
}

export class ObjectStorageNotFoundError extends Error {
  readonly code = 'OBJECT_STORAGE_NOT_FOUND';

  constructor(objectKey: string) {
    super(`Object is not available: ${objectKey}`);
    this.name = 'ObjectStorageNotFoundError';
  }
}

export class ObjectStorageSecurityError extends Error {
  readonly code = 'OBJECT_STORAGE_METADATA_FORBIDDEN';

  constructor(message: string) {
    super(message);
    this.name = 'ObjectStorageSecurityError';
  }
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.trim().toLowerCase();
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ObjectStorageValidationError(`${name} must be a positive integer`);
  }
}

function assertSafeSegment(value: string, name: string): string {
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    throw new ObjectStorageValidationError(`${name} contains an invalid object-key segment`);
  }
  return normalized;
}

function assertManagedObjectKey(objectKey: string): void {
  const parts = objectKey.split('/');
  if (
    parts.length !== 5 ||
    parts[0] !== 'team-tj' ||
    parts[1] !== 'private' ||
    (parts[2] !== 'supplementary-file' && parts[2] !== 'cover-image')
  ) {
    throw new ObjectStorageSecurityError('Object key is outside the private Team-TJ namespace');
  }
  parts.slice(2).forEach((part, index) => assertSafeSegment(part, `object key segment ${index}`));
}

function parseManagedObjectKey(objectKey: string): {
  readonly scope: ObjectStorageScope;
  readonly sessionId: string;
  readonly objectId: string;
} {
  assertManagedObjectKey(objectKey);
  const [, , scope, sessionId, objectId] = objectKey.split('/');
  return { scope: scope as ObjectStorageScope, sessionId, objectId };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function cloneBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function assertSafeProviderMetadata(metadata: Readonly<Record<string, string>>): void {
  const forbiddenMetadataKey = /(credential|secret|password|cookie|token|authorization|header)/i;
  for (const [key, value] of Object.entries(metadata)) {
    if (forbiddenMetadataKey.test(key) || forbiddenMetadataKey.test(value)) {
      throw new ObjectStorageSecurityError(
        'Credential, Cookie, Token, authorization, or secret metadata is not allowed',
      );
    }
  }
}

function createProviderMetadata(
  scope: ObjectStorageScope,
  mimeType: string,
  sizeBytes: number,
  contentHash: string,
): Readonly<Record<string, string>> {
  return {
    'x-team-tj-visibility': 'private',
    'x-team-tj-scope': scope,
    'x-team-tj-content-type': mimeType,
    'x-team-tj-content-size': String(sizeBytes),
    'x-team-tj-sha256': contentHash,
  };
}

function policyFor(
  scope: ObjectStorageScope,
  policies: Readonly<Record<ObjectStorageScope, ObjectStoragePolicy>>,
): ObjectStoragePolicy {
  const policy = policies[scope];
  if (!policy) {
    throw new ObjectStorageValidationError(`No object-storage policy exists for ${scope}`);
  }
  assertPositiveInteger(policy.maxBytes, `${scope} maxBytes`);
  return policy;
}

function validatePayload(
  input: {
    readonly bytes: Uint8Array;
    readonly mimeType: string;
    readonly expectedSha256?: string;
  },
  policy: ObjectStoragePolicy,
): { readonly mimeType: string; readonly sizeBytes: number; readonly sha256: string } {
  const mimeType = normalizeMimeType(input.mimeType);
  const sizeBytes = input.bytes.byteLength;
  if (sizeBytes === 0) {
    throw new ObjectStorageValidationError('Object content must not be empty');
  }
  if (sizeBytes > policy.maxBytes) {
    throw new ObjectStorageValidationError(
      `Object exceeds the ${policy.scope} size limit of ${policy.maxBytes} bytes`,
    );
  }
  if (!policy.allowedMimeTypes.map(normalizeMimeType).includes(mimeType)) {
    throw new ObjectStorageValidationError(`MIME type is not allowed for ${policy.scope}`);
  }

  const contentHash = sha256(input.bytes);
  if (input.expectedSha256 !== undefined && input.expectedSha256 !== contentHash) {
    throw new ObjectStorageValidationError('Provided SHA-256 does not match object content');
  }
  return { mimeType, sizeBytes, sha256: contentHash };
}

export function createPrivateObjectKey(input: {
  readonly scope: ObjectStorageScope;
  readonly sessionId: string;
  readonly objectId: string;
}): string {
  const scope = assertSafeSegment(input.scope, 'scope');
  if (scope !== 'supplementary-file' && scope !== 'cover-image') {
    throw new ObjectStorageValidationError('Unsupported object-storage scope');
  }
  const sessionId = assertSafeSegment(input.sessionId, 'sessionId');
  const objectId = assertSafeSegment(input.objectId, 'objectId');
  return `${OBJECT_STORAGE_NAMESPACE}/${scope}/${sessionId}/${objectId}`;
}

export class PrivateObjectStorageAdapter {
  private readonly policies: Readonly<Record<ObjectStorageScope, ObjectStoragePolicy>>;
  private readonly hooks: ObjectStorageLifecycleHooks;

  constructor(
    private readonly provider: ObjectStorageProvider,
    options: {
      readonly policies?: Readonly<Record<ObjectStorageScope, ObjectStoragePolicy>>;
      readonly hooks?: ObjectStorageLifecycleHooks;
    } = {},
  ) {
    this.policies = options.policies ?? DEFAULT_OBJECT_STORAGE_POLICIES;
    this.hooks = options.hooks ?? {};
  }

  async uploadPrivate(input: {
    readonly scope: ObjectStorageScope;
    readonly sessionId: string;
    readonly objectId: string;
    readonly bytes: Uint8Array;
    readonly mimeType: string;
    readonly expectedSha256?: string;
  }): Promise<StoredPrivateObject> {
    const policy = policyFor(input.scope, this.policies);
    const validated = validatePayload(input, policy);
    const objectKey = createPrivateObjectKey(input);
    const bytes = cloneBytes(input.bytes);
    const metadata = createProviderMetadata(
      input.scope,
      validated.mimeType,
      validated.sizeBytes,
      validated.sha256,
    );
    assertSafeProviderMetadata(metadata);

    try {
      await this.provider.putPrivate({
        objectKey,
        bytes,
        contentType: validated.mimeType,
        metadata,
      });
    } catch (error) {
      throw toSafeInfrastructureError(error, 'Private object storage is unavailable.');
    }

    return {
      objectKey,
      scope: input.scope,
      sessionId: input.sessionId,
      objectId: input.objectId,
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
      sha256: validated.sha256,
      visibility: 'private',
      storedAt: new Date(),
    };
  }

  async readPrivate(objectKey: string): Promise<ReadPrivateObject> {
    const identity = parseManagedObjectKey(objectKey);
    let providerObject: ProviderObject | null;
    try {
      providerObject = await this.provider.readPrivate(objectKey);
    } catch (error) {
      throw toSafeInfrastructureError(error, 'Private object storage is unavailable.');
    }
    if (!providerObject) {
      throw new ObjectStorageNotFoundError(objectKey);
    }

    const metadataHash = providerObject.metadata['x-team-tj-sha256'];
    const metadataScope = providerObject.metadata['x-team-tj-scope'];
    const metadataVisibility = providerObject.metadata['x-team-tj-visibility'];
    const metadataContentType = providerObject.metadata['x-team-tj-content-type'];
    const metadataContentSize = providerObject.metadata['x-team-tj-content-size'];
    const contentHash = sha256(providerObject.bytes);
    if (
      metadataHash !== contentHash ||
      metadataScope !== identity.scope ||
      metadataVisibility !== 'private' ||
      metadataContentType !== normalizeMimeType(providerObject.contentType) ||
      metadataContentSize !== String(providerObject.bytes.byteLength)
    ) {
      throw new ObjectStorageSecurityError(
        'Stored object integrity or private-scope metadata does not match content',
      );
    }
    const sizeBytes = providerObject.bytes.byteLength;
    const policy = policyFor(identity.scope, this.policies);
    validatePayload({ bytes: providerObject.bytes, mimeType: providerObject.contentType }, policy);

    return {
      objectKey,
      ...identity,
      mimeType: normalizeMimeType(providerObject.contentType),
      sizeBytes,
      sha256: contentHash,
      visibility: 'private',
      storedAt: providerObject.lastModified,
      bytes: cloneBytes(providerObject.bytes),
    };
  }

  async archivePrivate(objectKey: string): Promise<void> {
    parseManagedObjectKey(objectKey);
    try {
      await this.provider.archivePrivate(objectKey);
    } catch (error) {
      throw toSafeInfrastructureError(error, 'Private object storage is unavailable.');
    }
  }

  async deletePrivate(objectKey: string): Promise<void> {
    parseManagedObjectKey(objectKey);
    try {
      await this.provider.deletePrivate(objectKey);
    } catch (error) {
      throw toSafeInfrastructureError(error, 'Private object storage is unavailable.');
    }
  }

  async listOrphans(input: {
    readonly scope: ObjectStorageScope;
    readonly olderThan: Date;
    readonly referencedObjectKeys: ReadonlySet<string>;
  }): Promise<readonly OrphanedObject[]> {
    const prefix = `${OBJECT_STORAGE_NAMESPACE}/${input.scope}/`;
    let entries: readonly ProviderObjectEntry[];
    try {
      entries = await this.provider.listPrivate({ prefix });
    } catch (error) {
      throw toSafeInfrastructureError(error, 'Private object storage is unavailable.');
    }
    const orphans: OrphanedObject[] = [];
    for (const entry of entries) {
      const identity = parseManagedObjectKey(entry.objectKey);
      const contentHash = entry.metadata['x-team-tj-sha256'];
      if (
        input.referencedObjectKeys.has(entry.objectKey) ||
        entry.archivedAt !== undefined ||
        entry.lastModified >= input.olderThan ||
        !contentHash ||
        !/^[a-f0-9]{64}$/.test(contentHash)
      ) {
        continue;
      }
      orphans.push({
        objectKey: entry.objectKey,
        ...identity,
        mimeType: normalizeMimeType(entry.contentType),
        sizeBytes: entry.sizeBytes,
        sha256: contentHash,
        visibility: 'private',
        storedAt: entry.lastModified,
        lastModified: entry.lastModified,
        archivedAt: entry.archivedAt,
      });
    }
    return orphans;
  }

  async cleanupOrphans(input: {
    readonly scope: ObjectStorageScope;
    readonly olderThan: Date;
    readonly referencedObjectKeys: ReadonlySet<string>;
    readonly mode?: OrphanCleanupMode;
  }): Promise<OrphanCleanupResult> {
    const mode = input.mode ?? 'archive';
    const orphans = await this.listOrphans(input);
    for (const orphan of orphans) {
      if (mode === 'archive') {
        await this.archivePrivate(orphan.objectKey);
      } else {
        await this.deletePrivate(orphan.objectKey);
      }
      await this.hooks.onOrphanCleaned?.(orphan, mode);
    }
    return {
      inspected: orphans.length,
      cleaned: orphans.length,
      retainedAuditHashes: orphans.map((orphan) => ({
        objectKey: orphan.objectKey,
        sha256: orphan.sha256,
        action: mode,
      })),
    };
  }
}
