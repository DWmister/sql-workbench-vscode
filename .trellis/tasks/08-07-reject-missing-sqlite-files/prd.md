# Reject missing SQLite database files

## Goal

Prevent a mistyped or stale SQLite database path from being accepted as a
successful connection and displayed as an empty database.

## Background

- `connectionTester.ts`, `schema/inspector.ts`, and `query/runner.ts` pass
  `undefined` to `new SQL.Database(...)` when the configured path does not
  exist. `sql.js` interprets that value as a request for a new in-memory
  database.
- The connection test therefore reports success, schema inspection returns no
  tables, and a write query can persist a new empty database at the unintended
  path.
- The change is a patch-level reliability fix in the current `0.3.x` release
  line, targeted for `0.3.1`.

## Requirements

- R1: Every SQLite operation must reject an absent path, a missing filesystem
  entry, and a path that does not identify a regular readable file before
  constructing a `sql.js` database.
- R2: Connection testing and schema inspection must expose the validation error
  to their existing UI callers instead of reporting a successful empty
  database.
- R3: Query execution and pagination must report the same validation failure and
  must not create a database file at an invalid path.
- R4: Valid SQLite database files must continue to support schema inspection,
  query execution, pagination, and persistence without behavior changes.
- R5: The cumulative workflow verification must cover missing-file rejection and
  the valid-file path.
- R6: `package.json`, `package-lock.json`, the README version badges, and
  `CHANGELOG.md` must consistently describe version `0.3.1`. Product roadmap
  content remains unchanged because this is a defect fix, not a new feature.

## Acceptance Criteria

- [x] Testing a connection whose SQLite file does not exist returns a clear
  failure containing the configured path.
- [x] Loading schema metadata from a missing SQLite file rejects instead of
  returning an empty table list.
- [x] Executing SQL or fetching a page against a missing SQLite file returns an
  error and leaves the filesystem unchanged.
- [x] A valid SQLite fixture still exposes its tables and supports the existing
  read/write and pagination verification.
- [x] `npm run check`, `npm run verify`, and VSIX packaging succeed.
- [x] The generated `sql-workbench-vscode-0.3.1.vsix` exists, declares version
  `0.3.1`, and excludes development-only files.

## Out of Scope

- Adding a UI workflow for creating a new SQLite database.
- Replacing `sql.js` with a native SQLite driver.
- Changing SQLite WAL behavior or concurrent-write semantics.
