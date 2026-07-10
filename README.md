# SQL Workbench

SQL-first database workbench for VS Code.

SQL Workbench keeps database work inside the editor: write SQL in normal `.sql` files, switch the active connection from the status bar, inspect schema metadata, and run statements without a paid feature wall.

[简体中文](README_CN.md) • [Repository](https://github.com/DWmister/sql-workbench-vscode)

![Version](https://img.shields.io/badge/version-0.2.0-2ea44f)
![VS Code](https://img.shields.io/badge/VS%20Code-1.90%2B-007ACC)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6)
![Databases](https://img.shields.io/badge/MySQL%20%7C%20PostgreSQL%20%7C%20SQLite-supported-2ea44f)
![License](https://img.shields.io/badge/license-MIT-2ea44f)

![Connection form](docs/images/connection-form.png)

## Why SQL Workbench?

| Capability | What it changes |
| --- | --- |
| SQL-first editing | SQL stays in native VS Code editors, so formatting, snippets, search, Git, and shortcuts work as expected. |
| SQL file connection binding | Use the status bar or tree commands to bind a SQL file to a connection, with recovery prompts when moved files match a previous SQL fingerprint. |
| Read-only table properties | Click a table to inspect columns and load migration-oriented DDL with copy and refresh actions, without enabling schema writes. |
| Alias-aware completions | `bs.` only suggests fields from the table aliased as `bs`, with comments and types in the suggestion list. |
| DDL hover preview | Hover SQL table names to inspect a lightweight column, primary-key, and index summary. |
| CodeLens run actions | Run an individual SQL statement from an inline CodeLens without moving the cursor. |
| SQL variables | Use `:name` or `$name` variables, review values before execution, and prefill defaults from `sqlWorkbench.variables`. |
| Dangerous SQL confirmation | Confirm before running `UPDATE` or `DELETE` statements without a real `WHERE` clause. |
| Result export | Open an export dialog to choose CSV, JSON, or XLSX for the current page or the full pageable result. |
| Read-only JSON cell viewer | Open values from JSON/JSONB columns in a read-only popup with Format, Copy, and Close actions. |
| Permanent editing boundary | Result grids and table properties are always read-only. All data and schema changes must be made through SQL. |

## Screenshots

### Read-only table properties and DDL

![Read-only table properties and DDL](docs/images/schema-view.png)

### Alias-aware SQL completion

![Alias-aware SQL completion](docs/images/sql-completion.png)

## Features

- MySQL/MariaDB, PostgreSQL, and SQLite connection profiles.
- Grouped database tree in the VS Code activity bar.
- Webview connection form with save, edit, and test connection actions.
- Shortcut connection strings such as `mysql://root:password@127.0.0.1:3306/app?name=prod&group=sr`.
- Personal connection metadata is stored in extension `globalState`; workspace connection metadata can live in `.vscode/sql-workbench.json`.
- Passwords are never read from workspace files and stay local in VS Code `SecretStorage`.
- SQL file connection binding with status bar, QuickPick switching, and fingerprint-based recovery prompts for moved files.
- SQL snippets and completions for keywords, tables, and scoped columns.
- SQL table hover summaries for columns, primary keys, and indexes.
- Per-statement CodeLens run actions in `.sql` editors.
- SQL variables with execution-time prompts and workspace defaults from `sqlWorkbench.variables`.
- Dangerous SQL confirmation for `UPDATE` and `DELETE` statements without a real `WHERE` clause.
- `Cmd+Enter` on macOS or `Ctrl+Enter` on Windows/Linux runs the current SQL statement.
- Result webview with Table/JSON modes, pagination, CSV/JSON/XLSX export, and a read-only JSON/JSONB cell viewer.
- Read-only schema tree: connection -> tables -> table -> columns.
- Read-only table properties opened in the active editor group with Columns and on-demand DDL tabs.

## Quick Start

```bash
# Install dependencies.
npm install

# Validate TypeScript types without writing build output.
npm run check

# Compile extension sources into out/.
npm run compile

# Start locally:
# open this folder in VS Code, press F5, and use the Extension Development Host.
```

After the extension starts:

1. Open the `Database` activity bar view.
2. Click `Add Connection`.
3. Fill the form or paste a shortcut connection string.
4. Use `Test Connection`, then `Save`.
5. Open or create a `.sql` file and run the current statement with `Cmd+Enter` or `Ctrl+Enter`.

## Shortcut Connection Strings

Supported examples:

```text
mysql://root:password@127.0.0.1:3306/app?name=local-mysql&group=local
postgresql://postgres:password@127.0.0.1:5432/app?name=local-pg&group=local
sqlite:///Users/me/database.sqlite?name=local-sqlite&group=local
```

Supported schemes:

- `mysql://`
- `mariadb://`
- `postgresql://`
- `postgres://`
- `sqlite://`

## Workspace Connections

Teams can share non-secret connection profiles in `.vscode/sql-workbench.json`:

```json
{
  "version": 1,
  "connections": [
    {
      "id": "local-pg",
      "name": "Local PostgreSQL",
      "type": "postgresql",
      "group": "Local",
      "host": "127.0.0.1",
      "port": 5432,
      "database": "app",
      "username": "postgres",
      "readonly": true
    }
  ]
}
```

Do not include `password`, `privateKey`, or `token` fields. The extension skips workspace profiles with sensitive fields and continues loading other valid profiles; each developer enters credentials locally on first use, and they are stored in VS Code `SecretStorage`.

## Versioning

Current enhancement release line: `0.2.x`.

- Enhancement fixes and small improvements: bump patch versions, for example `0.2.1`.
- Larger feature updates before the full release: bump minor versions, for example `0.3.0`.
- Full version with the planned complete feature set: bump major version to `1.0.0`.

## Local Verification

```bash
# Type-check the project.
npm run check

# Build the extension output used by VS Code.
npm run compile

# Run v0.2 core workflow checks against compiled output.
# Covers SQL parsing/ranges, variables, dangerous SQL detection, workspace
# connections/SecretStorage, result export serialization, DDL Hover, CodeLens, SQL file
# binding recovery, MySQL/PostgreSQL pagination paths, SQLite schema metadata,
# read-only JSON cell viewing, and webview behavior/syntax.
npm run verify:v0.2

# Regenerate README screenshots after UI changes.
npm run screenshots

# Package a local VSIX for installation testing.
npx --yes @vscode/vsce package

# Optional: choose a non-default Chrome executable for screenshot generation.
CHROME_PATH="/path/to/chrome" npm run screenshots
```

## How It Works

1. Personal connections are saved and edited through `ConnectionStore`; workspace connections are loaded read-only from `.vscode/sql-workbench.json`.
2. SQL execution is routed by database type:
   - SQLite uses `sql.js`.
   - MySQL/MariaDB uses `mysql2`.
   - PostgreSQL uses `pg`.
3. Schema metadata is loaded through database-specific inspectors.
4. SQL completions parse the current statement, resolve aliases from `FROM` and `JOIN`, and scope fields to the matching table.
5. SQL file connection bindings are stored in workspace state; execution, CodeLens, completion, and hover prefer the active document's binding before falling back to the default connection. Saved SQL files also record a content fingerprint so moved or renamed files can prompt to restore their previous binding.
6. SQL variables are collected before execution and bound through the database driver; values are not interpolated into raw SQL strings.
7. Dangerous SQL detection ignores strings, quoted identifiers, and comments before prompting for `UPDATE` or `DELETE` without `WHERE`.
8. SQL CodeLens actions use the same statement parser as keyboard execution, so semicolons inside strings or comments do not split statements.
9. SQL hovers use the bound connection's schema metadata to show lightweight table summaries without generating full DDL.
10. Table properties load full DDL only when the DDL tab opens; MySQL uses `SHOW CREATE TABLE`, SQLite reads `sqlite_schema`, and PostgreSQL reconstructs migration-oriented DDL from system catalogs.
11. SQL Results and Table Properties open in the active editor group instead of creating a split editor.
12. Result exports are written by the extension host after a VS Code save dialog; the webview never receives filesystem write access.
13. Only JSON/JSONB result columns expose the read-only cell viewer; other data types remain plain cells until dedicated viewers are added.

## Editing Boundary

Result grids and table properties are read-only in every version. The extension will not add result-cell editing; all data and schema changes must be expressed and executed as SQL. Future releases may add read-only viewers for more data types, but those viewers will not provide save or mutation actions.

## Roadmap

- **All versions:** result grids and table properties remain read-only; data and schema changes are SQL-only. Additional cell viewers may be added only as read-only tools.
- `0.1.x`: MVP query workflow, SQL completion refinements, and connection-form polish.
- `0.2.x`: CSV/JSON/XLSX result export, JSON result view, SQL variables, dangerous SQL confirmation, workspace connections, SQL file connection binding, richer connection editing, DDL hover and table-property DDL, CodeLens run actions, and high-frequency Premium-style enhancements.
- `0.2.x`: Extension-level configuration for custom execution shortcuts.
- `0.2.x`: Better packaging through bundling to reduce VSIX size.
- `0.2.x`: Richer connection editing and import/export.
- `0.3.x`: Query history and result workflow refinements.
- `1.0.0`: Complete planned feature set.

## FAQ

### Can I run writes?

Yes, through SQL execution only. Result grids and table properties never write to the database.

### Where do SQL files live?

They live in your normal VS Code workspace as `.sql` files. The extension does not require a proprietary query document format.

### How are passwords stored?

Passwords are stored in VS Code `SecretStorage`. Personal connection metadata is stored in extension `globalState`; workspace connection metadata can be committed as `.vscode/sql-workbench.json` as long as it contains no secrets.

### Can I edit saved connections?

Yes. Personal connections open in the same webview form used for creation. Leaving the password field blank keeps the existing saved password; entering a new password replaces it. Workspace connections are read-only and must be changed in `.vscode/sql-workbench.json`.
