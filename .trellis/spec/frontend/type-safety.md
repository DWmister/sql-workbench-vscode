# Type Safety

> Type safety patterns in this project.

---

## Overview

<!--
Document your project's type safety conventions here.

Questions to answer:
- What type system do you use?
- How are types organized?
- What validation library do you use?
- How do you handle type inference?
-->

(To be filled by the team)

---

## Type Organization

<!-- Where types are defined, shared types vs local types -->

(To be filled by the team)

---

## Validation

<!-- Runtime validation patterns (Zod, Yup, io-ts, etc.) -->

(To be filled by the team)

---

## Common Patterns

<!-- Type utilities, generics, type guards -->

(To be filled by the team)

## Scenario: Optional database metadata in SQL result columns

### 1. Scope / Trigger

- Trigger: a database driver exposes auxiliary metadata for a result column that must cross the query-runner to Webview boundary.
- Owner: the shared result contract in `src/results/types.ts`; renderers must not infer database metadata from display names.

### 2. Signatures

```typescript
interface QueryColumn {
  name: string;
  type?: string;
  comment?: string;
}
```

### 3. Contracts

- `name` is the SQL result label and remains the export key.
- `type` is normalized from driver metadata when available.
- `comment` is optional and may be populated only when the driver provides a reliable source-column identity.
- Standard MySQL source identity is `(schema || db, orgTable, orgName)`, with the real `mysql2` runtime using `schema`; PostgreSQL source identity is `(tableID, columnID)`.
- MySQL-protocol-compatible databases such as StarRocks may leave `schema`, `orgTable`, and `orgName` empty. In that case, resolve only simple `SELECT` projections through the executed SQL's `FROM` / `JOIN` aliases and result-column position.
- Strip standard selection modifiers (`DISTINCT`, `DISTINCTROW`, `ALL`) before deciding whether a projection is a simple source column.
- SQL projection fallback must preserve position so duplicate result labels such as `profile.document_type` and `verification.document_type` retain different source tables.
- A sole `*` or `alias.*` projection may map result field names to the single resolved table. Expressions, ambiguous stars, and unmatched projection counts remain without comments.
- SQLite, computed expressions, and unknown source columns leave `comment` undefined.

### 4. Validation & Error Matrix

- Empty or whitespace-only database comment -> `undefined`.
- Missing/zero source identity -> skip the metadata query for that column.
- Missing MySQL driver source identity + simple qualified projection -> resolve through the SQL table alias map.
- Missing MySQL driver source identity + `SELECT DISTINCT alias.column` -> resolve `alias.column` through the SQL table alias map.
- Missing MySQL driver source identity + expression/ambiguous projection -> leave `comment` undefined; do not match only by result label.
- MySQL fixture or adapter reads only `db` and ignores runtime `schema` -> invalid contract; tests must use `schema` to mirror `mysql2`'s `ColumnDefinition`.
- MySQL `information_schema` projection is consumed without explicit aliases -> invalid contract; always alias result keys before mapping because server metadata casing may differ from the SQL source spelling.
- Auxiliary metadata query fails -> preserve the successful SQL rows and return columns without comments.
- Comment contains HTML or newlines -> escape before Webview rendering; encode attribute newlines.

### 5. Good / Base / Bad Cases

- Good: a base-table column alias keeps the source-field comment because the driver identity is reliable.
- Good: StarRocks returns no original field metadata, but `SELECT profile.document_type, verification.document_type` maps each result position through its own table alias.
- Base: an expression such as `COUNT(*)` has no comment.
- Bad: matching a result alias to a schema field name and guessing its comment.

### 6. Tests Required

- Assert MySQL and PostgreSQL source identifiers map to the correct comments.
- Use a MySQL field fixture with `schema` and without `db`, matching the actual driver packet.
- Use a StarRocks-compatible fixture with empty `schema`, `orgTable`, and `orgName`; assert qualified join columns resolve by SQL projection position.
- Include duplicate result labels from different aliases and a single-table `SELECT *` regression.
- Include a `SELECT DISTINCT alias.column` regression for the compatibility fallback.
- Make the MySQL comment-query fixture return only the explicit alias keys, and assert those aliases exist in the generated SQL.
- Assert expression fields and empty comments remain undefined.
- Assert metadata-query failure does not set `QueryResult.error` or remove rows.
- Assert table headers escape comments and CSV/JSON/XLSX keys remain `column.name`.
- Cover direct execution and server-paged execution.

### 7. Wrong vs Correct

```typescript
// Wrong: the renderer invents metadata from the displayed alias.
const comment = schemaColumns.find((column) => column.name === resultColumn.name)?.comment;

// Correct: the query runner resolves a reliable driver identity once.
const column: QueryColumn = {
  name: field.name,
  type: normalizeType(field),
  comment: commentsBySource.get(sourceKey(field)),
};

// Correct fallback: compatible protocols use the executed projection position.
const sources = resolveMysqlColumnSources(sql, fields, connection.database ?? '');
const comment = commentsBySource.get(sourceKey(sources[columnIndex]));
```

---

## Forbidden Patterns

<!-- any, type assertions, etc. -->

(To be filled by the team)
