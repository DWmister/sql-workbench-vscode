# SQL Workbench

SQL-first database workbench for VS Code.

SQL Workbench keeps database work inside the editor: write SQL in normal `.sql` files, switch the active connection from the status bar, inspect schema metadata, and run statements without a paid feature wall.

[简体中文](README_CN.md) • [Repository](https://github.com/DWmister/sql-workbench-vscode)

![VS Code](https://img.shields.io/badge/VS%20Code-1.90%2B-007ACC)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6)
![Databases](https://img.shields.io/badge/MySQL%20%7C%20PostgreSQL%20%7C%20SQLite-supported-2ea44f)
![License](https://img.shields.io/badge/license-UNLICENSED-lightgrey)

![Connection form](docs/images/connection-form.png)

## Why SQL Workbench?

| Capability | What it changes |
| --- | --- |
| SQL-first editing | SQL stays in native VS Code editors, so formatting, snippets, search, Git, and shortcuts work as expected. |
| Active connection switching | Use the status bar or tree commands to switch the active database for the current SQL workflow. |
| Read-only schema inspection | Click a table to inspect columns, types, lengths, comments, nullability, and keys without enabling accidental GUI writes. |
| Alias-aware completions | `bs.` only suggests fields from the table aliased as `bs`, with comments and types in the suggestion list. |
| Safe MVP boundary | Result grids and schema views are read-only. Data and schema changes must be made through SQL. |

## Screenshots

### Read-only schema inspector

![Read-only schema inspector](docs/images/schema-view.png)

### Alias-aware SQL completion

![Alias-aware SQL completion](docs/images/sql-completion.png)

## MVP Features

- MySQL/MariaDB, PostgreSQL, and SQLite connection profiles.
- Grouped database tree in the VS Code activity bar.
- Webview connection form with save and test connection actions.
- Shortcut connection strings such as `mysql://root:password@127.0.0.1:3306/app?name=prod&group=sr`.
- Passwords stored in VS Code `SecretStorage`; non-secret metadata stored in extension `globalState`.
- Active connection status bar item and QuickPick switcher.
- SQL snippets and completions for keywords, tables, and scoped columns.
- `Cmd+Enter` on macOS or `Ctrl+Enter` on Windows/Linux runs the current SQL statement.
- Read-only result webview for query output.
- Read-only schema tree: connection -> tables -> table -> columns.
- Read-only table column inspector opened beside the editor.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Type-check and compile
npm run check
npm run compile

# 3. Launch the extension from VS Code
# Press F5 in VS Code, or use the Extension Development Host.
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

## Verification

```bash
npm run check
npm run compile
npm run screenshots
npx --yes @vscode/vsce package
```

`npm run screenshots` renders the README images with headless Chrome. Set `CHROME_PATH` if Chrome is not installed at the default macOS path:

```bash
CHROME_PATH="/path/to/chrome" npm run screenshots
```

## How It Works

1. Connections are saved through `ConnectionStore`.
2. SQL execution is routed by database type:
   - SQLite uses `sql.js`.
   - MySQL/MariaDB uses `mysql2`.
   - PostgreSQL uses `pg`.
3. Schema metadata is loaded through database-specific inspectors.
4. SQL completions parse the current statement, resolve aliases from `FROM` and `JOIN`, and scope fields to the matching table.
5. Results and schema views render as read-only webviews.

## MVP Boundary

The MVP intentionally does not support editing result cells, editing columns, or deleting schema objects through the UI. Those actions must be performed with SQL. Inline editing can be revisited after the read-only SQL workflow is stable.

## Roadmap

- `0.2`: Extension-level configuration for custom execution shortcuts.
- `0.2`: Better packaging through bundling to reduce VSIX size.
- `0.2`: Richer connection editing and import/export.
- `0.3`: Query history and result export refinements.
- Later: Optional guarded GUI editing workflows.

## FAQ

### Can I run writes?

Yes. Writes are supported through SQL execution. The UI does not provide result-cell or schema-object editing in the MVP.

### Where do SQL files live?

They live in your normal VS Code workspace as `.sql` files. The extension does not require a proprietary query document format.

### How are passwords stored?

Passwords are stored in VS Code `SecretStorage`. Normal connection metadata is stored in extension `globalState`.

### Why are screenshots generated?

The README screenshots are created by `npm run screenshots` so UI documentation can be refreshed after visual changes.
