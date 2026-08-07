# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

(To be filled by the team)

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)

## Scenario: Existing SQLite file boundary

### 1. Scope / Trigger

- Trigger: Extension Host code opens a configured SQLite connection through
  `sql.js` for testing, schema inspection, query execution, or pagination.
- Reason: `new SQL.Database(undefined)` creates an empty in-memory database, so
  an unchecked missing path becomes a false successful connection.

### 2. Signatures

```typescript
function readSqliteDatabaseFile(
  filePath: string | undefined,
): Promise<{ path: string; bytes: Buffer }>;
```

### 3. Contracts

- `src/connection/sqliteFile.ts` is the single owner of filesystem validation
  and reading for configured SQLite files.
- Callers construct `sql.js` databases only from the returned `bytes`.
- Query persistence uses the validated returned `path`; it must not recover the
  original optional value independently.
- Connection testing returns a failed `ConnectionTestResult`, schema inspection
  rejects for the tree to display, and query APIs translate the same error into
  `QueryResult.error`.

### 4. Validation & Error Matrix

- Missing/blank path -> `SQLite connection is missing a database file path.`
- `ENOENT` -> `SQLite database file does not exist: <path>`.
- Directory or another non-file entry ->
  `SQLite database path is not a file: <path>`.
- Stat/access failure -> actionable `Unable to access...` error with the path.
- Read failure -> actionable `Unable to read...` error with the path.
- Existing readable regular file -> return its exact path and bytes.

### 5. Good / Base / Bad Cases

- Good: a valid database is tested, inspected, queried, paged, and persisted.
- Base: an existing zero-byte file may be opened as a new empty SQLite database.
- Bad: a nonexistent path reports connected or a write query creates that path.

### 6. Tests Required

- Assert connection testing rejects missing and directory paths with the path in
  the message.
- Assert schema inspection rejects a missing file.
- Assert execute and fetch-page return errors and leave the missing path absent.
- Assert an explicitly created SQLite fixture still covers schema, read/write,
  and pagination behavior.

### 7. Wrong vs Correct

```typescript
// Wrong: undefined asks sql.js to create an empty in-memory database.
const bytes = fs.existsSync(filePath) ? await fs.promises.readFile(filePath) : undefined;
const database = new SQL.Database(bytes);

// Correct: validate once and construct only from verified bytes.
const databaseFile = await readSqliteDatabaseFile(filePath);
const database = new SQL.Database(databaseFile.bytes);
```
