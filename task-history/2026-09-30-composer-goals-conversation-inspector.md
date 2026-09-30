# Composer commands, native goals and conversation inspector

Date: 2026-09-30, Asia/Singapore.

## Request and final behavior

- Add `/` command selection and `@` file completion, and adapt goal mode. Goal information belongs on the composer island.
- Inspect the installed Codex components and reproduce the highlighted compact tool records, right-side subagent/output panel and file-change summary.
- Only merge neighboring calls of the same kind. Reads show a collapsed “已读取 X 个文件”. Remove tool bubbles and completion badges; failures alone show a red X 失败.

## Implementation

- PromptEditor captures the caret token without consuming image chips or surrounding text, supports keyboard completion and IME, and restores separators/focus. Slash actions open the actual model/effort/permission/project/tasks/settings/help/goal controls. File search uses the current device's fuzzyFileSearch API and cwd, with cancellation, timeout, response validation and stale-response rejection.
- useCodex implements thread/goal/get/set/clear and notifications with per-device/thread state, settings acknowledgments, new-thread creation, unsupported feature handling and mutation race guards. GoalPanel renders real objective/status/budget/usage/time on the persistent island slot, hiding the summary during approvals; its manager preserves failed drafts and allows pause/resume/update/clear. No additional turn/start follows goal/set.
- buildActivityRows preserves turn/message/reasoning boundaries and separates server-declared command actions, MCP server/tool pairs and collab operations. ToolActivityGroup defaults closed, counts real read paths and maintains stable identities during streaming. MessageItem retains syntax highlighting and detailed errors without normal completion labels. Global activity styling is transparent and compact.
- buildThreadInsights projects only loaded parent-thread history into child IDs/statuses and completed file patches. useThreadInspector fetches only visible/explicitly requested children through bounded read-only APIs. ThreadInspector uses a restrained right surface or a narrow-screen modal, initially six agents, expandable details and explicit open-conversation controls.
- FileChangeSummary initially lists three files with known +/- counts, expanding raw diff content on request. Unknown patch formats suppress counts. Output creation appends a document/presentation/spreadsheet/site request to the existing composer without sending.
- Native desktop behavior was checked in the installed 26.928.20755 archive/extracted reference. Desktop output creation adds a plugin-targeted prompt; the web adaptation uses ordinary task text. Desktop filesystem undo uses host apply-patch and cannot be substituted with thread/revert. Detailed evidence is in docs/research.md.

## Files

App.vue, style.css, shared/protocol.ts; PromptEditor, GoalPanel, ApprovalIsland, Model/Permission/Reasoning/WorkingDirectory/DisplaySettings controls; MessageItem, ToolActivityGroup, ThreadInspector and FileChangeSummary; useCodex and useThreadInspector; composer-trigger, composer-commands, thread-goal, tool-activity and thread-insights helpers; mock daemon and unit/E2E suites; README, DESIGN, research and CURRENT_STATUS.

## Verification and limits

- Full unit suite: **409 pass, 0 fail, 2261 assertions, 17 files**. Tests cover real in-memory RPC flows, stale replies and settings races, read-only inspector behavior, homogeneous grouping, stateful component expansion, failures, command escaping and diff accounting.
- `bun run build` passes Vue/TypeScript checks and rebuilds dist/PWA. The existing nonfatal main-chunk size warning remains.
- `bun run test:e2e --list`: **128 cases in 7 files**. New flows and mocks typecheck; this is discovery, not an E2E execution claim.
- Browser/TCP execution remains blocked by the restricted environment's listener/Chromium socket failures. No live user goal, conversation edit, file operation or subagent task was sent for verification. The project was not committed, pushed or deployed.
- Goals require server support and the goals feature. File statistics cover currently loaded recorded patches, not net Git changes. Desktop-only artifact inventory, plugin bindings and filesystem undo are not claimed.
