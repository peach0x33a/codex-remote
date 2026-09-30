# Requirements review, archive access and settings dialog

Date: 2026-09-30, Asia/Singapore.

## Current requests

The user asked about earlier requirements, where archived conversations went, whether archiving belongs to the frontend or Codex, a proper settings dialog, and task-center styling consistent with the updated sidebar and radius scale.

## Requirement coverage

| Request | Code implementation and boundary |
| --- | --- |
| Installed-app model/permission UX, separate model and effort | ModelPicker, ReasoningPicker, PermissionPicker; settings remain editable during a turn for subsequent submissions. |
| Device entry only at top right, row edit, separate add, connected color and uniform hover | DevicePicker in App.vue header; no device section in the sidebar. |
| Wider configurable conversation, dark/light/system | DisplaySettings and useAppearance; width and theme persist per browser. |
| Settings in a proper dialog | Now a 720px desktop BaseDialog with visible appearance/background/width sections, responsive scrolling and focus restoration. |
| Project-grouped sidebar, compact native-app styling, directory selector | ProjectSidebar and WorkingDirectoryPicker; directory selector is the default composer-island shelf. |
| Approval/Ask single-card island with next/previous and automatic advance | ApprovalIsland and ApprovalCard; request drafts survive navigation and failures. |
| Queue in the same island, editing/removing and server-level cross-client sync | QueuePane and server-queue.ts; supported daemon persists Web/PWA jobs. Legacy fallback is explicitly page-local. Native TUI pending-list parity remains unimplemented. |
| Inline image chips, hover preview and typing after paste | PromptEditor, InlineImage, ImagePreview; text/image order and caret handling have regression coverage. |
| Markdown, message edit/withdraw | markdown-engine.ts and MessageRevisionEditor/useCodex; revisions use actual server revert and preserve failed drafts. |
| Recover hung session loading | Bounded resume/history requests, cancellation, late-response protection, retry and older-item pagination. |
| Real reasoning, empty entries hidden, thinking/work timers, retry/compaction status | MessageItem and useCodex handle native reasoning deltas/history and real timestamps; empty reasoning omitted; retry/compaction replace the working-status text. |
| Context ring and available details | ContextIndicator shows server-provided counters/window, without fabricated tool/skill/system shares. |
| Configurable image background, dark animation, background in conversations, no sidebar-collapse jump | BackgroundSettings, WorkspaceBackground and viewport-anchored HeroBackdrop; per-theme opacity/blur/color settings and IndexedDB image storage. |
| Consistent radii, smoother effort slider, restrained motion, custom dropdowns | Shared radius tokens, EffortSlider and CustomSelect; task center updated to the compact neutral sidebar language. |
| Clickable update toast and terse copy | UpdateToast; removed composer/collaboration filler. This review also removed the forgotten browser-tab tagline and related installation/connection promotional text. |
| Agent Command Center and bounded recent discovery | Read-only task view with grouping, filters and details. Main projects and tasks share the latest observed activity date plus the prior calendar date; historical sources are not fully enumerated. |
| collabAgentToolCall parsing and command highlighting | collab-tool.ts parses real tool types; command-highlight.ts renders escaped, lossless shell markup with light/dark colors. |
| Archive access and restoration | New sidebar entry and ArchiveDialog: server-backed title search, 30-row manual pages, failure retention and explicit restore/open. |

## Archive ownership

The frontend calls thread/archive and only removes the row after success. The local Codex thread processor persists the operation through its thread store. Restoring calls thread/unarchive; listing uses thread/list with archived:true. The generated ThreadListParams and ThreadUnarchiveResponse schemas under /tmp/codex-remote-schema-experimental were checked, as was the local app-server thread_processor.rs implementation. No Codex source or user archive files were modified directly.

## Verification

- `bun test tests/unit`: 259 passed, 0 failed, 1599 assertions across 11 files.
- `bun run build`: passed, including Vue and TypeScript checks for application/server/test code. Main bundle is 532.50 kB; Agent Command Center and ArchiveDialog are separate 20.20 kB and 4.66 kB chunks. The existing non-fatal main-chunk size warning remains. PWA assets were rebuilt with 22 precache entries.
- `bun run test:e2e --list`: 110 cases discovered across 6 files. Added archive cases for manual pagination, server search, restoration and failure retention; settings cases cover modal/focus behavior and persisted appearance/background settings.
- Source inspection found no native `<select>` elements or the rejected tagline/missing-reasoning/collaboration filler in the current frontend.

Browser cases are not claimed as executed: integration listeners currently fail with EADDRINUSE on port 0, and Chromium startup is rejected with setsockopt: Operation not permitted.

## Additional defects corrected during review

- The task center's background source list omitted sub-agents. Local Rust `source_kind_matches` confirms `subAgent` covers all variants; including that filter restores descendant aggregation without a third query or historical metadata fan-out. Tests use source-filtered paginated fixtures with both interactive and sub-agent activity anchors.
- Acknowledged per-thread settings cached in the browser could override current settings from `thread/resume`. Versioned snapshots now distinguish old cache from notifications/acknowledgments arriving during a read, while unsaved and failed edits remain intact. Missing legacy fields retain their known values; an explicit null effort resets it.
- A successful direct submission could leave an obsolete settings debounce pending. The acknowledgment now consumes that earlier debounce only when no newer edit exists. Tests confirm later server settings survive both reopening and the expired debounce period.
- Archive listing explicitly sends `modelProviders: []`: the local Codex implementation otherwise filters to the configured provider. Normal interactive-source semantics are preserved.

One localhost:3000 read returned the newly built bundle, but a following connection failed; this is insufficient to claim continuous service health. No existing service/daemon was killed or restarted. No live user conversation was archived/restored during verification. No commit or push was requested.
