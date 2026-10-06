# Async question adaptation

Date: 2026-10-05

Request: expose Codex's pending async questions in Remote with the TUI's Shift + Left entry, so a user can answer questions while Codex continues working.

Implemented:
- Read native `agentMessage.delivery = "async"` and `questions` metadata, preserve original question indices and deduplicate lifecycle/history records.
- A compact question-count button opens an answer form in the existing composer island. Desktop supports Shift + Left to answer and Shift + Right to return to the prompt; mobile uses touch buttons. Choices default to the first suggestion, with a free-text alternative; free-text-only questions remain blank until answered. Navigation and collapsing preserve drafts. Only question fields scroll, keeping Submit visible on mobile; coexisting native approvals and questions share one bounded viewport.
- Capture the exact native reply shape using a real CLI 0.160.0 TUI connected to a test WebSocket fixture. Replies carry the native question identifier in a tagged JSON input, use `turn/steer` for running work and `turn/start` after completion, and retain existing duplicate, connection and turn safeguards. Failed submissions preserve the question and answer. Completed-question replies are restored from history rather than redisplayed as pending.
- Native tagged replies render readable question/answer text in user messages and pending steering. Structured answers have an explanatory disabled Edit action; users can supplement them with a new message. Async question arrival uses the existing attention notification preference.
- Completion paging can show the question panel without losing the slash-command draft and returns to the completion page when closing the question. Blocking approvals retain their existing response path.

Validation: 693 Bun unit/integration tests passed (5,937 assertions across 52 files), Vue/server typechecks and Vite/PWA build passed, and 14 focused desktop/mobile browser tests passed. Protocol tests use a literal captured TUI input and cover history, failure, duplicate submission and device-switch races. Browser scenarios cover selected/custom answers, keyboard/touch entry, draft retention, retry, idle/reload recovery and coexisting approvals, plus the existing native approval, steering and island skill flows. Desktop light and mobile dark screenshots inspected; the Impeccable mechanical check returned no findings. Existing local service health and byte-for-byte served index/entry asset checks passed. Test commands cleared inherited HTTP proxy environment variables for isolated loopback fixtures; no application proxy configuration was changed.

No backend restart or external publication was performed. The local production frontend build is generated in `dist/`.
