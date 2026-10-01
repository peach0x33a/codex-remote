# 2026-09-30 — Composer, connection persistence and independent devices

## Request
Implement the accumulated composer/island and conversation-menu refinements, remove the duplicate sidebar new-chat action, persist connection credentials, resume paused goals, use explicit goal slash semantics, connect multiple devices simultaneously, and correct Chromium toggle rendering.

## Delivered
- Commands, mentions and skills replace the island surface. Source tabs and horizontal navigation share only actual approval, queue, steer and reasoning pages; request drafts survive navigation. Native skills/plugins/thread references round-trip through messages and queues.
- Project and compact goal share one row. Paused goal has a direct resume button; /goal alone opens management, arguments start directly, /goal edit restores the original objective, and /goal status expands details for eight seconds.
- Conversation menu has native rename/archive/fork, local pin, copy, new-window and independent side-chat actions. Removed the duplicate expanded-sidebar new-chat button; logo remains the home/new-chat entry.
- Nonconsecutive document operations aggregate counts without discarding details. Sent input is optimistic; busy composers with input show queue/steer instead of Stop. Pending pre-dispatch steers can be withdrawn. Completed file summaries hide as soon as the next round starts.
- Multiple device runtimes keep separate transports, threads, goals, settings and queues. Switching does not disconnect peers. Background notices aggregate; connection states and per-device disconnect are visible. Input drafts restore on device switches, and config requests are scope guarded.
- Bearer credentials persist only on the Bun server in private atomic files. Browser metadata contains a 64-hex reference, never the token. Credentials are endpoint-bound. The dialog supports remember, replace, clear and removal; failed operations retain prior configuration. APP_CREDENTIALS_FILE can select the private path; .local/ is ignored by Git.
- Shared ToggleSwitch has explicit geometry and white thumb contrast in both themes, plus keyboard, reduced-motion and forced-colors support.

## Verification
- bun test tests/unit tests/integration/credentials.test.ts: 793 pass, 0 fail, 4687 assertions across 37 files. Real RPC/state composables are exercised with in-memory transports; credential APIs use the actual handler with a mocked listener.
- bun run build: typecheck and production build pass; dist/ regenerated. The main chunk retains a non-fatal size warning.
- Playwright --list: 198 cases across 9 files discovered. Cases updated for the new goal behavior, menus and floating island.
- Focused Impeccable detector: no findings for the new/edited controls. git diff --check passed.

## Boundaries
- Real browser execution and listener-based bridge integration remain unverified under the existing environment restrictions. No policy workaround, live model tasks, production credentials, archive operations or file undo were used in verification.
- Already-accepted turn/steer input cannot be cancelled by the installed App Server API. UI does not claim otherwise; pre-dispatch input and actual server queues have genuine removal paths.
- The scheduled-task menu entry is disabled because this App Server does not expose that API. Slash entries describe implemented frontend actions, not every TUI-only command. Native TUI pending-input display remains distinct from the shared Web queue.
- Run the updated Bun service for credential endpoints; existing connections need the token saved once using Remember token. Preserve the credential directory when deploying containers.
- No commit, push or service deployment in this phase. Existing work outside these changes was preserved.

## Main paths
src/App.vue; src/components/{ApprovalIsland,GoalPanel,ThreadActionsMenu,SideChat,DevicePicker,ConnectionDialog,ToggleSwitch,PromptEditor}.vue; src/composables/{useCodex,useCodexWorkspace,useStoredChoice}.ts; src/lib/{credentials,profiles,rpc,goal-command,mentions,skills,prompt,tool-activity}.ts; server/{credentials,bridge,index}.ts; tests/unit/; tests/integration/credentials.test.ts; tests/e2e/.

