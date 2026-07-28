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

## Scenario: Host-owned AI drafts and model configuration

### 1. Scope / Trigger

- Trigger: Agent Chat receives a Webview action for a prompt, SQL draft, or
  model-configuration form.
- Owner: decoders and Extension Host modules under `src/ai/`.
- Reason: Webview messages are untrusted, and Agent Chat is deliberately not
  an SQL execution surface.

### 2. Signatures

```typescript
type AiWebviewMessage =
  | { type: 'insertDraft'; conversationId: string; draftId: string }
  | { type: 'openDraft'; conversationId: string; draftId: string };

interface AiConfigurationSavePayload {
  baseUrl: string;
  model: string;
  explainInstructions: string;
  apiKey?: string;
  removeApiKey: boolean;
}
```

### 3. Contracts

- `decodeAiWebviewMessage(unknown)` is the only Agent Chat decoder and rejects
  extra fields.
- Draft messages carry identifiers only. SQL and connection data are always
  resolved from `AiSessionStore` in the Extension Host.
- Agent Chat defines no approve, run, execute, paginate, or export action.
- `AiSqlDraftHost` may insert a draft into an existing SQL document or open a
  new SQL document. It never calls `QueryRunner`.
- After Insert/Open, the host refreshes SQL CodeLens so `Run Statement` and
  `AI Explain` are available in the editor.
- The configuration Webview receives only Base URL, exact Model ID, and
  `hasApiKey`; it never receives the saved API Key.
- A blank Key preserves the existing SecretStorage value, a non-empty Key
  replaces it, and explicit removal deletes it only if the resulting
  configuration remains valid.
- The OpenAI-compatible adapter and Agent runtime redact the exact configured
  API Key, the bound connection's saved database password, URL user information,
  and structured connection fields before request serialization or
  workspace-state persistence.
- Runtime loads the current API/database secrets once per Agent run, then uses
  the in-memory values to sanitize new input and any older persisted messages,
  drafts, or tool summaries before they can re-enter model context.
- Connection sanitization is context-aware: it must not replace matching
  substrings inside ordinary SQL identifiers or values.
- Recent host-stored SQL drafts are projected as reference-only assistant
  context for follow-up requests, then trimmed by the same context budget as
  conversation messages.

### 4. Validation & Error Matrix

- Unknown protocol version or extra Agent Chat field -> reject.
- Webview-supplied SQL, connection data, or execution action -> reject.
- Unknown/extra configuration payload field -> reject.
- Empty Base URL or Model ID -> reject in the Extension Host.
- Provider/product name used instead of an exact Model ID -> API error is
  sanitized and shown; configuration UI explains how to correct the ID.
- Blank Key with an existing Key -> preserve existing SecretStorage value.
- Remove Key on a remote HTTPS endpoint -> reject because the configuration
  requires a Key; do not partially save.
- Insert into a non-SQL editor -> reject with an actionable message.
- User pastes the configured API Key into prompt/draft content -> redact before
  model serialization and persistence.
- User pastes a connection URL with credentials -> redact its user information,
  host, and port before serialization and persistence.
- Connection username `app` plus SQL identifier `applications` -> preserve the
  SQL identifier; do not use unrestricted substring replacement.
- SQL value equals the connection port -> preserve the SQL value unless it is
  part of structured connection data.
- Follow-up references the previous SQL draft -> include the recent host-owned
  draft as bounded reference data before the latest user message.

### 5. Good / Base / Bad Cases

- Good: `{ conversationId, draftId }` resolves trusted SQL, inserts it, binds
  the document connection, and refreshes CodeLens.
- Base: opening a draft creates an untitled document with language `sql`.
- Bad: accepting `{ sql, connectionId }` from the Webview.
- Bad: returning the saved API Key to the configuration page for masking.
- Bad: retaining an Agent-only `executeReadOnly` QueryRunner method after the
  UI button is removed.

### 6. Tests Required

- Agent Chat decoder rejects extra SQL and every former approval message.
- Source-surface regression proves no `Review & run`, approval message,
  `executeReadOnly`, or `fetchReadOnlyPage` remains.
- Insert/Open tests assert connection binding and CodeLens refresh.
- Configuration decoder rejects extra fields.
- Configuration tests cover Key preserve, replace, remove, and no Key
  disclosure in rendered HTML.
- Webview script tests assert Enter sends, Shift+Enter does not send, and IME
  composition does not send.
- Model-adapter tests assert the configured Key is absent from serialized
  message/tool payloads while the Authorization header remains correct.
- Runtime/session tests assert an exact configured Key is absent from
  workspace-state messages and drafts.
- Runtime tests assert the saved database password and pasted connection URL
  are absent from model requests and workspace state, while ordinary SQL
  identifiers, port-valued predicates, and password-column assignments remain
  unchanged.
- Runtime tests assert the latest user message stays last and recent SQL drafts
  are available to follow-up requests within the context budget.
- Webview tests assert `maxlength` uses the shared host protocol limit.

### 7. Wrong vs Correct

```typescript
// Wrong: Agent Chat becomes an execution authority.
runner.executeReadOnly(connection, { sql: message.sql });

// Correct: resolve the host-owned draft and move it into an SQL editor.
await drafts.insert(message.conversationId, message.draftId);
await activeConnection.set(connection.id, editor.document);
sqlCodeLens.refresh();
```

## Scenario: Chronological Agent Chat timeline

### 1. Scope / Trigger

- Trigger: persisted Agent messages and SQL drafts are projected from
  `AiConversation` into Agent Chat Webview state.
- Owner: `buildAiConversationTimeline` in `src/ai/agentViewProvider.ts` and
  timeline rendering in `src/ai/agentViewHtml.ts`.
- Reason: messages and drafts are stored in separate arrays, but grouping
  those arrays during rendering can place an old draft after a new SQL
  explanation.

### 2. Signatures

```typescript
type AiConversationTimelineItem =
  | { type: 'message'; id: string; role: 'user' | 'assistant'; text: string; createdAt: number }
  | { type: 'draft'; id: string; title: string; sql: string; rationale?: string; createdAt: number };

function buildAiConversationTimeline(
  conversation: AiConversation,
): AiConversationTimelineItem[];
```

### 3. Contracts

- Extension Host merges persisted messages and drafts into one timeline and
  sorts it by ascending `createdAt` before posting Webview state.
- Equal timestamps use the deterministic order user message, SQL draft,
  assistant message; original array order breaks remaining ties.
- Webview renders the unified timeline directly. It must not regroup entries
  by type.
- The active streaming assistant response is appended after the persisted
  timeline.
- Agent Chat constrains the message pane as the flex scroll container and
  scrolls it to `scrollHeight` immediately and on the next animation frame
  after every state or stream render.

### 4. Validation & Error Matrix

- Missing/non-array `selected.timeline` -> render the empty conversation
  prompt; do not iterate an untrusted object.
- Historical draft timestamp before a new Explain prompt/response -> draft
  stays before both new messages.
- User, draft, and assistant share one timestamp -> render user, draft,
  assistant deterministically.
- Stream delta arrives -> current stream remains the last visible entry and
  the message pane moves to the newest content.
- Final state replaces a stream -> persisted assistant message occupies its
  chronological position without leaving a duplicate stream entry.

### 5. Good / Base / Bad Cases

- Good: an old generated SQL draft remains above a later SQL Explain exchange.
- Base: a conversation containing only messages renders in message order.
- Bad: render every `messages` entry and then every `drafts` entry.
- Bad: set `scrollTop` on an unconstrained element while the Webview document
  itself owns the scrollbar.

### 6. Tests Required

- Timeline unit test interleaves messages and drafts with different
  `createdAt` values and asserts exact ID order.
- Equal-timestamp regression asserts user, draft, assistant tie order.
- Webview regression asserts unified `selected.timeline` rendering, a
  constrained `100vh` flex scroll container, and the post-layout
  `requestAnimationFrame` scroll.
- Existing Webview syntax and CSP checks must continue to pass.

### 7. Wrong vs Correct

```javascript
// Wrong: every historical draft is forced below the newest response.
for (const message of messages) appendMessage(message);
for (const draft of drafts) appendDraft(draft);

// Correct: Extension Host supplies one chronological projection.
for (const item of selected.timeline) {
  if (item.type === 'message') appendMessage(item.role, item.text);
  if (item.type === 'draft') appendDraft(item);
}
```

## Scenario: Global SQL Explain instructions

### 1. Scope / Trigger

- Trigger: the model-configuration Webview saves optional preferences that
  apply only to SQL Explain requests.
- Owners: configuration decoding/storage, `AiAgentViewProvider`, and
  `AiAgentRuntime`.
- Reason: user preferences may customize language, format, and review focus,
  but must not replace the fixed Explain or System safety requirements.

### 2. Signatures

```typescript
const MAX_AI_EXPLAIN_INSTRUCTIONS_LENGTH = 4_000;

interface AiConfigurationSavePayload {
  explainInstructions: string;
}

interface AiAgentExplainInput {
  instructions?: string;
}
```

Public setting: `sqlWorkbench.ai.explainInstructions`, global string, default
`""`, maximum 4000 characters.

### 3. Contracts

- Configuration Webview sends `explainInstructions` as a required string and
  the strict decoder rejects missing, extra, or incorrectly typed fields.
- Configuration storage trims and writes the value to global VS Code Settings;
  it never writes this non-secret preference to SecretStorage.
- Empty/whitespace-only input stores `""` and preserves the original default
  Explain Prompt byte-for-byte.
- `AiAgentViewProvider` reads the current global value for each Explain action
  and passes it explicitly to `AiAgentRuntime.explainSql`.
- Runtime assembles fixed Explain requirements, optional preferences, then the
  `<sql_to_explain>` block. Ordinary Agent Chat prompts do not read the setting.
- System safety Prompt stays fixed, and Runtime still has no QueryRunner or
  execution tool regardless of preference content.

### 4. Validation & Error Matrix

- Non-string Webview value -> reject the save message.
- Trimmed value longer than 4000 characters -> reject before settings update.
- Empty value -> save `""`; omit the preference block from Explain.
- Preference conflicts with no-execution rules -> retain the text as a user
  preference, but fixed System Prompt and capability boundaries remain active.
- Preference contains the configured API Key -> redact before model request
  serialization and conversation persistence.
- Extra configuration payload field -> reject at the Webview boundary.

### 5. Good / Base / Bad Cases

- Good: `Respond in Chinese and focus on indexes.` appears once before the SQL
  block while fixed Explain requirements remain first.
- Base: blank instructions produce the existing default Explain Prompt.
- Bad: treating the preference as a replacement System Prompt.
- Bad: applying SQL Explain preferences to ordinary Agent Chat messages.
- Bad: storing preferences together with the API Key in SecretStorage.

### 6. Tests Required

- Configuration persistence covers save, load, trim, clear, and 4001-character
  rejection.
- Webview decoder covers required string, wrong type, extra fields, and maximum
  length; rendered HTML covers the textarea, counter, and no saved-Key leak.
- Provider test asserts the stored global value reaches `AiAgentExplainInput`.
- Prompt unit test asserts default compatibility, one-time insertion, and
  fixed -> preference -> SQL ordering.
- Runtime test asserts conflicting preferences cannot remove the System
  no-execution rule, exact secrets are redacted, and ordinary Chat is unchanged.

### 7. Wrong vs Correct

```typescript
// Wrong: custom text replaces the safety and baseline behavior.
const messages = [{ role: 'system', content: customInstructions }];

// Correct: custom text is an optional user-level addition.
const userContent = buildExplainUserContent(sql, customInstructions);
return runWithFixedSystemPrompt(userContent);
```
