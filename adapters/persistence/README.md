# Persistence boundary

Task 2.1 defines the provider-neutral persistence boundary for the Team-TJ workflows.

- `migrations/0001_initial.sql` targets PostgreSQL and creates the relational metadata schema.
- Uploaded file and cover bytes are intentionally not stored in database columns; `object_key` and integrity metadata point to a later private object-storage adapter.
- Immutable versions, source records, source links, and audit events are append-only in the migration. Archive markers provide soft deletion without mutating historical versions.
- `domain/persistence/models.ts` and `domain/persistence/repositories.ts` are the type-safe contracts consumed by later database adapters and in-memory test doubles.
- No repository implementation assumes local-disk persistence, a specific ORM, or a specific managed database vendor beyond PostgreSQL migration syntax.
