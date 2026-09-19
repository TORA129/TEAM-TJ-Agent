# Private object-storage boundary

`private-object-storage.ts` is a provider-neutral, server-only boundary for supplementary files and cover images. Providers receive only private object keys, bytes, validated MIME/size values, and generated integrity metadata; callers cannot supply provider metadata.

- Keys are isolated under `team-tj/private/{scope}/{sessionId}/{objectId}`.
- Uploads compute SHA-256 and write only hash/size/MIME metadata alongside the private object.
- Reads re-check hash, scope, visibility, content type, and size metadata.
- `AssetStorageService` hands repository contracts only object metadata. Raw bytes never enter `SupplementaryFile` or `CoverAsset` records.
- Archive/delete and orphan lifecycle methods retain object hashes for audit callbacks. Credential, Cookie, Token, authorization, secret, and password metadata is rejected.

Concrete object-storage vendors can implement `ObjectStorageProvider` without changing domain or route code. No upload route is defined here.
