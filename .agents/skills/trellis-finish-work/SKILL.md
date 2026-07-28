---
name: trellis-finish-work
description: "Wrap up the current session without staging or committing: verify the quality gate, optionally archive completed tasks, and optionally record session progress. Use when done coding and ready to hand work back to the user."
---

# Finish Work

Wrap up the current session without changing Git history. A clean working tree
is not required. Never stage or commit from this skill, and never infer commit
permission from task completion.

## Step 1: Survey current state

```bash
python3 ./.trellis/scripts/get_context.py --mode record
```

This prints:

- **My active tasks** — review whether any besides the current one are actually done (code merged, AC met) and should be archived this round.
- **Git status** — quick visual on what's dirty.
- **Recent commits** — informational only; uncommitted work is expected.

If `--mode record` surfaces completed tasks, ask whether the user wants them
archived. Default is no, including for the current task.

## Step 2: Report dirty paths

Run:

```bash
git status --porcelain
```

Classify every dirty path as **current task** or **unrelated/parallel work**.
Do not filter Trellis paths out: with `session_auto_commit: false`, they remain
ordinary visible working-tree changes.

- Paths referenced in the current task's `prd.md` / `implement.jsonl` / `check.jsonl` → current task
- Paths in code areas matching the task's stated scope, or that you remember editing this session → current task
- Paths in unrelated areas you have no recollection of touching this session → other parallel work

Report both groups. Do not run `git add`, `git commit`, `git tag`, or `git push`.

## Step 3: Archive task(s)

```bash
python3 ./.trellis/scripts/task.py archive <task-name>
```

Run this only for tasks the user explicitly chose to archive. With
`session_auto_commit: false`, the script must leave the move/status change
uncommitted. If the user did not request archival, skip this step.

## Step 4: Record session journal

```bash
python3 ./.trellis/scripts/add_session.py \
  --title "Session Title" \
  --summary "Brief summary" \
  --no-commit
```

Run this only when the user wants a journal entry. Committed hashes are
optional; omit `--commit` for uncommitted work. The command must not stage or
commit any file.
