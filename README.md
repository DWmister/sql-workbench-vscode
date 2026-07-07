# SQL Workbench VS Code Extension

Local-first database client MVP for VS Code.

## MVP Principles

- Unlimited saved connections.
- Grouped connection tree.
- Passwords and secrets are stored in VS Code `SecretStorage`.
- Normal connection metadata is stored in extension `globalState`.
- SQL files stay in the native VS Code editor.
- MVP write operations are SQL-only. Result grids and schema inspectors are read-only.

## Current Stage

First-stage scaffold includes:

- Extension manifest and Database activity bar view.
- Connection model and connection store.
- Grouped connection TreeView.
- Add / edit name / delete / refresh connection commands.
- Active connection status bar item and QuickPick switcher.
- `Open Query` command that opens an untitled SQL file bound by comment to the selected connection.
- Basic SQL snippets.

## Development

```bash
npm install
npm run check
npm run compile
```

Launch the extension from VS Code with the generated `out/extension.js` as the extension entrypoint.
