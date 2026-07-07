# SQL Workbench VS Code Extension

Local-first database client MVP for VS Code.

## MVP Principles

- Unlimited saved connections.
- Grouped connection tree.
- Passwords and secrets are stored in VS Code `SecretStorage`.
- Normal connection metadata is stored in extension `globalState`.
- SQL files stay in the native VS Code editor.
- MVP write operations are SQL-only. Result grids and schema inspectors are read-only.

## MVP Scope

Implemented MVP includes:

- Extension manifest and Database activity bar view.
- Connection model and connection store for MySQL/MariaDB, PostgreSQL, and SQLite.
- Grouped connection TreeView.
- Webview connection form with save and test connection actions.
- Edit name / delete / refresh connection commands.
- Active connection status bar item and QuickPick switcher.
- `Open Query` command that opens an untitled SQL file bound by comment to the selected connection.
- Run current SQL statement or full SQL document from the native VS Code editor.
- `Shift+Enter` runs the current SQL statement.
- Read-only result webview for query output.
- Read-only schema tree: connection -> tables -> table -> columns.
- Read-only table column inspector opened beside the editor.
- Basic SQL snippets and completions for SQL keywords, active-connection tables, and columns.

The MVP intentionally does not support editing result cells, editing columns, or deleting schema objects through the UI. Those changes must be made with SQL.

## Development

```bash
npm install
npm run check
npm run compile
```

Launch the extension from VS Code with the generated `out/extension.js` as the extension entrypoint.
