<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

## Release Version and VSIX Packaging

- When starting a new modification after the previous product changes have been committed, update the extension version once. Keep `package.json`, `package-lock.json`, the README version badges, and `CHANGELOG.md` in sync.
- If the current product changes are still uncommitted, follow-up fixes must keep the existing in-progress version instead of incrementing it again.
- Build the newest VSIX with `npx --yes @vscode/vsce package` after every modification and validation pass, even when the version stays unchanged; overwrite/rebuild the VSIX for the current version.
- Verify that the generated `sql-workbench-vscode-<version>.vsix` exists and matches the version declared in `package.json`.
- Do not stage or package unrelated local files. In particular, `s.sql` is local-only and must never be committed.

## Roadmap Alignment and Public-Repository Preflight

- Before implementation and again before packaging, committing, or pushing, compare the change against `README.md`, `README_CN.md`, and `database-client-roadmap.html`; record the intended release line in the task artifacts when a Trellis task exists.
- When a completed change belongs to the current release line, update all three roadmap artifacts to describe it accurately. If the change is more appropriate for the next minor version or later, present that classification to the user and obtain confirmation before adding it to the current release scope.
- Before staging or pushing to a public repository, inspect the staged diff for credentials, tokens, private keys, connection strings, private endpoints or IP addresses, and internal database/schema/table/account identifiers. Replace them with generic fixtures or redact them before the public push.
- Before publishing a VSIX, inspect its file list with `npx --yes @vscode/vsce ls --tree` or `unzip -l`. Exclude `.trellis`, `.agents`, `.codex`, task/research artifacts, and other development-only files through `.vscodeignore`; a VSIX must contain only runtime and intended public documentation assets.
- A passing build or VSIX package does not replace the public-repository preflight. Do not push while any sensitive or internal operational detail remains in the staged diff.
