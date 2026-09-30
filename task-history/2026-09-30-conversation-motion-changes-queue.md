# Conversation motion, changes viewer, queue behavior and composer entry

Date: 2026-09-30, Asia/Singapore.

## Requests
- Add visible, restrained animation; hide the edited-files summary on a new turn.
- Match Desktop file icons, green/red diffs, undo, diff toolbar and scope picker.
- Align active-turn send/queue behavior with Codex TUI.
- Display exhausted/429 errors within the conversation, not a global banner.
- Replace context 万 formatting with K/M, retaining real values.
- Keep the home input narrow and fixed, then expand/move to configured width on input or project selection.

## Implementation
- Home area is capped at 760px including horizontal padding, responsive to available space. The existing editable DOM persists while a measured 420ms width/translation animation enters the conversation layout; returning home uses 280ms. Focus, drafts, IME behavior and inline attachments remain on the same editor. Resize/unmount/reduced-motion changes cancel stale effects. Home does not adopt configured conversation width before engagement.
- Token formatting uses English decimal compact K/M units, spaces around the slash, and hover titles for exact counts. 22.9万 / 25.8万 becomes 229K / 258K; capacity is not hardcoded to 1M.
- Tool details, grouped expansion, inspector, goal summary and file folds have bounded transitions. Hidden content becomes inert before leaving. Inspector data loading remains read-only.
- A latest-turn card with file-type icons and green/red counts opens a native-style changes panel. All history remains accessible through the inspector; a new turn hides the card even before any new tool event arrives.
- Changes panel supports last turn, HEAD/worktree, index/worktree, cached, first-parent commit and branch merge-base/worktree scopes, file jump and tree, refresh, wrap, collapse/expand, unified/split/auto, content search and patch copy. Narrow toolbar controls move into More; mobile uses a native dialog with its popovers inside the dialog. Submenu focus and stale collapsed-path issues found by review were corrected.
- Complete native turn patches can be undone/reapplied after explicit confirmation. The remote helper checks the entire patch and snapshots, uses Git reverse/forward application, and preserves the index and unrelated files. Conflict, unsupported content and uncertain command outcomes are surfaced instead of forcing overwrite. Git and Python 3 are required remotely; read/undo and listing bounds are documented in README.
- Enter during an active turn now steers that turn; Tab and the queue action enqueue. Structured compact/review rejection alone permits fallback to the queue. Delayed/uncertain sends are not duplicated. Daemon queues remain daemon-dispatched; fallback local queues can continue after observed ordinary failure and pause after interruption or uncertain starts.
- Terminal failures are isolated by device/thread/turn, including submission failures and restored failed history. Inline TurnFailure renders literal server text, preserves request IDs, suppresses willRetry events, and exposes continuation only for an actual failed turn. Retry sends an explicit continuation using the existing turn/start path and leaves the user's draft untouched. No unsupported turn/retry RPC is used.
- The changes viewer now has a small outer gap and a border/radius on all four corners, so it reads as a separate right-side surface without consuming excessive space. Inline image chips use the same line box as adjacent user text. Direct sends add an optimistic userMessage to the rendered turns while `turn/start` is waiting; matching server content removes the temporary row, and failed or disconnected starts clean it up.

## Source reference
Installed ChatGPT/Codex 26.928.20755 archive and byte-matched extracted assets were read. Native toolbar, scope, undo and error mappings plus local codex-rs Enter/Tab/queue evidence are recorded in docs/research.md. No installed app or codex-rs code was modified. Rich preview, word diff and other unimplemented native extras are not claimed as feature parity.

## Verification
- Unit suite: 505 passed, 0 failed, 2772 assertions across 22 files.
- Follow-up targeted component/token tests: 17 passed, 45 assertions after retry affordance refinement.
- TypeScript/Vue checks and production/PWA build passed. Main bundle retains a non-fatal size warning, about 678 kB minified.
- 140 Playwright cases across 7 files discovered. Added cases cover editor persistence and motion, reduced motion/project activation, K/M counts, terminal failure/retry, Enter/Tab, changes scopes/controls and undo confirmation. They are not claimed as browser-executed.
- Full test command: 504 passed; bridge integration setup failed because Bun.serve could not bind localhost port 0 (EADDRINUSE) in the restricted environment. Previously observed Chromium socket/sandbox restrictions also remain; no repeated launch attempt was made.
- Git fixtures exercise real isolated repositories for safe undo/reapply, rename, binary/symlink/hardlink rejection, merge-base and SHA-256 empty-tree behavior. Mock browser command fixtures do not claim live-device filesystem coverage.
- No live model message, live conversation rollback or user filesystem undo was executed. No commit, push, service restart or deployment was requested/performed during this phase.

## Main files
src/App.vue; src/style.css; src/composables/useCodex.ts; src/composables/useComposerEntrance.ts; src/components/ChangesPanel.vue; DiffCode.vue; FileTypeIcon.vue; FileChangeSummary.vue; MotionCollapse.vue; ThreadInspector.vue; MessageItem.vue; ToolActivityGroup.vue; GoalPanel.vue; ComposerPopover.vue; ContextIndicator.vue; TurnFailure.vue; src/lib/worktree-changes.ts; diff-view.ts; details-motion.ts; thread-insights.ts; server-queue.ts; turn-failure.ts; format-tokens.ts; tests/unit; tests/e2e; tests/mock-daemon.ts; README.md; DESIGN.md; docs/research.md; CURRENT_STATUS.md.
