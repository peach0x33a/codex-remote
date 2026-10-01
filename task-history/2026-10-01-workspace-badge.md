# 2026-10-01 — Worktree/branch display, goal resume fix, Codex session review

## Request
Review the Codex session history, then continue: show the workspace (worktree) in the island independent of goals, and record that the /api/credentials 404 is resolved.

## Findings from the Codex session (01a0ee9f…)
The service died because it ran in a temporary terminal; Codex moved it to tmux session `codex-remote` (127.0.0.1:3000). Goal time was missing because tmux served a stale dist. The update prompt was decoupled from task state and moved to a header icon between task centre and device picker. The goal row gained pause/resume, edit and refresh. The user interrupted at "workspace display is unrelated to goal; show it whenever a worktree exists".

## Changes
- Fixed the goal island's resume button: its handler was `resume` (not called), so resuming did nothing; seven goal-panel-resume tests were failing. Pause and resume are now separate buttons bound to pause() and resume().
- readGitContext runs bounded read-only `rev-parse`/`symbolic-ref` via command/exec with the cleared Git environment shared with worktree-changes (git and remoteEnv are now exported). Linked worktrees are detected by git-dir differing from git-common-dir under `/worktrees/`. Detached HEAD shows a short commit; unborn branches keep their name; non-Git or malformed results yield no badge.
- useGitContext clears on device/directory/connection change, aborts superseded reads, ignores stale results and refreshes when a turn finishes.
- WorkspaceBadge sits in a new `workspace` slot of ApprovalIsland, after the project picker and before the goal; it does not depend on a goal.
- CURRENT_STATUS.md: /api/credentials marked resolved after the bridge restart.

## Verification
959 unit/integration tests pass (5045 assertions, 43 files); typecheck and build pass. New: tests/unit/git-context.test.ts (real git repos, linked/detached/unborn/non-Git), tests/unit/git-context-state.test.ts, tests/e2e/workspace-badge.e2e.ts (listed, not browser-executed; mock-daemon gained `worktree` and `branch` scenarios). `bun run build` regenerated dist, but the tmux service `codex-remote` was not restarted, so the live site may still serve the previous bundle. The badge has not been seen in a real browser.

No commit, push or deployment performed.
