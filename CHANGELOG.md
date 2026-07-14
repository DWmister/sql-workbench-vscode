# Changelog

All notable changes to SQL Workbench will be documented in this file.

## 0.2.2 - 2026-07-13

### Improved

- Result SQL previews have a bounded, scrollable code area so long statements do not push result data below the fold.
- Result SQL highlighting now matches the table DDL palette for keywords, functions, types, identifiers, strings, numbers, and comments in light and dark themes.

## 0.2.1 - 2026-07-13

### Improved

- Running the current cursor statement or a single selected statement now keeps the matching SQL fragment in the result panel and pageable reloads.
- Result SQL previews use theme-aware syntax colors for keywords, functions, strings, numbers, comments, and operators.
- SQL completion now includes uppercase common clauses and functions such as `DISTINCT`, `ORDER BY`, `CASE WHEN`, `COALESCE`, and `DATE_FORMAT`, with matching snippets.

### Fixed

- Cursor execution ignores leading SQL comments before the active statement, so logged or commented-out prior queries do not appear in the result SQL preview.

## 0.2.0 - 2026-07-09

### Added

- Result view can switch each tabular result between Table and JSON modes.
- Result export opens an options dialog and supports CSV, JSON, and XLSX for the current page or the full pageable query result.
- CSV export escapes delimiters, quotes, newlines, and spreadsheet formula prefixes.
- JSON export preserves numbers, booleans, nulls, and friendly BLOB metadata.
- JSON/JSONB result columns open a read-only View Cell Value popup with Format, Copy, and Close actions.
- SQL Results and Table Properties open in the active editor group instead of creating split editors.
- Result grids and table properties are permanently read-only; all database changes must be executed through SQL.
- SQL table hover shows a lightweight schema summary with columns, primary keys, and indexes.
- Read-only table properties add icon-labelled Columns/DDL tabs, theme-aware DDL syntax highlighting, copy, refresh, retry, and stale-request protection for MySQL, PostgreSQL, and SQLite.
- SQL editors show per-statement CodeLens actions for running a single statement without moving the cursor.
- SQL execution prompts for `:name` and `$name` variables, with workspace defaults from `sqlWorkbench.variables` and driver parameter binding.
- Workspace-level connection profiles can be loaded from `.vscode/sql-workbench.json`.
- Workspace connection files skip profiles with sensitive fields while continuing to load other valid profiles; passwords stay local in VS Code `SecretStorage`.
- Personal connections can be fully edited from the webview form, preserving saved passwords unless a new password is entered.
- SQL files can persist their own connection binding; Run, CodeLens, completion, and hover now prefer the active document's connection over the default fallback.
- Moved or renamed SQL files can restore previous connection bindings when their content fingerprint matches an earlier bound file.
- Dangerous SQL confirmation now guards `UPDATE` and `DELETE` statements without a real `WHERE` clause across keyboard, Run All, and CodeLens execution.
- SQL table-name completion no longer waits for metadata from the first 30 tables; the database tree seeds the completion cache, active SQL editors prewarm it, concurrent requests share one lookup, and column metadata loads only for referenced tables. SQL quick suggestions are enabled by default and `_` is an explicit trigger character.
- `npm run verify:v0.2` checks SQL parsing/ranges, variables, dangerous SQL detection, workspace connections/SecretStorage, result export serialization, DDL Hover and table DDL, CodeLens, completion fast paths, SQL file binding recovery, MySQL/PostgreSQL pagination paths, SQLite schema metadata, read-only JSON cell viewing, and webview behavior/script syntax.

## 0.1.0 - 2026-07-08

### Added

- Initial MVP release for VS Code.
- MySQL/MariaDB, PostgreSQL, and SQLite connection profiles.
- Grouped database tree and active connection status bar switcher.
- Webview connection form with test connection support.
- Shortcut connection string parsing.
- SQL-first query execution from native `.sql` files.
- `Cmd+Enter` on macOS and `Ctrl+Enter` on Windows/Linux to run the current SQL statement.
- Read-only query result view.
- Read-only table schema inspector.
- Alias-aware SQL completions with column type and comment details.

### Notes

- Result-cell and schema editing are intentionally unavailable; all writes must be executed through SQL.
