# 2026-09-30 — Input recall, completed work duration and credential API diagnostics

## Request
Recall historical input with Up when the composer is empty or the caret is at its first position. Show completed-turn work time beside the summary copy button. Diagnose the connection dialog reporting 接口不存在 when remembering a token.

## Changes
- PromptEditor has opt-in history navigation. Main and side-chat composers receive the current conversation inputs. Up recalls newest to oldest; further Up/Down navigates a snapshot and Down restores the unsubmitted draft. Edits and device/thread changes end the recall session. Menu selection, IME, modified keys, selected text and normal in-text cursor movement retain priority. Images, skills and thread/plugin references retain their structured parts. No input history is added to browser storage.
- CompletedTurnDurations maps only the final eligible assistant message of a completed turn to its native duration. Prefer durationMs; otherwise use native completion minus start timestamps. The footer shows a fixed 工作了 … beside the copy action. Missing native timing stays absent; progress, failures and in-progress turns do not receive a completed-work label. mergeTurn preserves a previously received native start when completion omits it.
- Credential POST/DELETE route-level 404s now explicitly identify the unavailable /api/credentials interface and the need to update/restart the Bun backend. Credential-not-found responses remain distinct. Errors retain drafts and do not fall back to plaintext browser storage. README explains development vs production restart.

## Verification
bun test tests/unit tests/integration/credentials.test.ts: 938 pass, 0 fail, 4975 assertions across 40 files. bun run build passed including both TypeScript checks and PWA output. Playwright --list discovered 204 cases across 9 files; browser tests were not executed. Existing listener/browser restrictions were respected.

## Unresolved runtime deployment
The source contains /api/credentials and its actual handler passed tests. The reported live route still returned 404. Only sandbox-local processes were visible, and no matching host service launcher was found, so the running PID/proxy target could not be identified or safely restarted. No production service, credentials or remote Codex daemon were touched. Restart the original Bun bridge launcher with its existing environment; rebuilding dist or restarting only Vite does not reload a non-watch Bun process.

## Files
src/lib/input-history.ts; src/components/PromptEditor.vue; src/lib/turn-duration.ts; src/components/MessageItem.vue; src/App.vue; src/components/SideChat.vue; src/composables/useCodex.ts; src/lib/credentials.ts; tests/unit/{input-history,turn-duration,credential-client,runtime-state}.test.ts; tests/e2e/composer-features.e2e.ts; tests/mock-daemon.ts; README.md.

Earlier changes remain uncommitted. No commit, push or deployment performed.

