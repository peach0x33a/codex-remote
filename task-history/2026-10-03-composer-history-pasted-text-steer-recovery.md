# Composer history, pasted text and terminal steer recovery

Date: 2026-10-03

## Request and result

The user requested cancellable steering, long-paste folding and caret following, persistent multi-entry Up/Down history, then showed an accepted steer stuck as pending after Stop.

Each pending steer is now bound to its actual turn ID. Terminal completion, interruption, failure and fresh resume metadata make an unmatched steer recoverable instead of leaving it permanently waiting. The island shows “回合已结束 · 未确认插入” with remove-hint and restore-draft controls. Completion snapshots reconcile actual user messages first; late echoes also reconcile. Ended hints do not count as active work. Restore preserves an existing draft and attachments and does not send automatically.

The installed Codex 0.159.0 native schema was generated into .local/steer-protocol and checked alongside https://learn.chatgpt.com/docs/app-server. It exposes turn/steer and whole-turn interrupt/revert, with no individual accepted-steer cancellation method. Pre-dispatch withdrawal remains real. Running, already accepted steers cannot be individually cancelled with the current API; removing a terminal hint does not claim to erase server history or undo executed actions. No invented RPC or silent whole-turn rollback was introduced.

Pastes of at least 1000 UTF-16 units or 12 lines become inline `[粘贴的文本 (xxx字符)]` chips with Unicode character counts. Activation expands text for editing; removal deletes that part. Full text, whitespace and attachment order are submitted through native UTF-8 text_elements placeholders. Restored pasted parts receive unique local IDs, preventing collisions when combined with a draft. Sent user messages expose full text through a disclosure. Paste, expansion and recall scroll only the editor to its caret; trailing-newline insertions receive a caret anchor.

Accepted website submissions are saved through /api/input-history into the existing private atomic server device/credential store. The latest 100 per device are independent of conversation pagination and shared across reloads and browser contexts. Native text, images, skills, mentions and pasted-text placeholders round-trip. Total stored history is capped at 16 MiB; removing a device purges its history. Existing loaded conversation inputs remain a fallback. Up/Down use a frozen browsing snapshot and restore the unsubmitted draft; completion, IME and ordinary text navigation retain priority. Background submissions retain their captured device ID.

## Files and validation

Code commit: 1f36f4375f97372b6318e099a5c1f2a9328056b3. Shared validation: shared/input-history.ts. Persistence/API: server/credentials.ts and server/bridge.ts. UI: src/composables/useInputHistory.ts, src/composables/useCodex.ts, src/lib/prompt.ts, PromptEditor.vue, ApprovalIsland.vue, PastedText.vue, App.vue, SideChat.vue and shared styles.

- 670 full unit/integration tests passed, 5770 assertions across 51 files. Terminal-before-ack, owning-turn isolation, snapshot-only reconciliation, late echoes, all three terminal statuses, private atomic persistence, concurrent writers, idempotency, device isolation, auth/origin checks, body limits, restart recovery and storage quotas were covered.
- Vue and server typechecks and the final Vite/PWA build passed. Existing bundle-size warning remains.
- 112 full desktop/mobile browser cases passed. An additional 10 cases passed against the exact final build after the pasted-part ID fix; 16 prompt/history unit cases passed after that fix. No test-count inflation or skips were added.
- Eight light/dark desktop/mobile captures were inspected in a bounded initial/confirmation pass. Final captures: .local/composer-review/final-pass.png. Real phones were not exercised.
- The native schema and official docs were read without connecting a live Codex daemon or creating generation requests. Isolated release preflight used a disposable private copy of the real store and verified the new history endpoint without modifying the production store.

Relevant logs: /tmp/codex-composer-all-tests.log, /tmp/codex-input-history-api-tests.log, /tmp/codex-composer-browser-final.log, /tmp/codex-composer-browser-exact.log and /tmp/codex-composer-final-types.log.

## Publication

Frontend and backend 1f36f43 published at 2026-10-03T23:12:05.694749+08:00. Bun was restarted from verified PID 3102363 to PID 527090, preserving its actual startup command/environment and 127.0.0.1:3000 listener. Existing requiresKey=false deployment behavior and the complete credential-file hash were preserved. Health, history reads for both saved devices, exact served HTML/SW/entry assets and no-cache policy were checked. 44 older hashed assets were retained.

Metadata: .local/deployment.json. Previous frontend: .local/releases/20261003-231205-before-1f36f43. Rollback backend source: .local/releases/20261003-231205-backend-b2266f5. Release script: .local/release-composer.py. Saved secrets were not printed, remote Codex processes were not restarted, and no Git push was performed.

## Limits

History begins with accepted website submissions after this feature; it does not bulk-import every historical conversation or every external TUI input. History writes report failures independently of message submission. Active accepted-steer cancellation requires an upstream API change; the terminal ghost state is fixed within the current protocol.
