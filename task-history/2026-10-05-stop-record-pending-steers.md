# Stop and record pending steers

Date: 2026-10-05

Request: when the user explicitly stops a conversation with pending steering messages, insert those messages immediately and keep the conversation stopped, without automatically starting generation.

Implemented:
- Stop captures acknowledged pending steers, including an older ended steer still in the current conversation, and waits for the interrupted turn and any in-flight steering acknowledgement.
- Read the owning turns' native user items before insertion. Already-consumed messages and late echoes reconcile by client identity or scoped input fingerprint, without duplicate display.
- Use native `thread/inject_items` for model-visible user context without generation. Independently persisted thread attachments store original structured inputs and commit receipts because raw injections do not appear in native item pagination. Stable reservations protect uncertain writes from automatic repetition.
- Saved messages display in order after the stopped-turn footer as completed user entries; their text, images, file references and placeholders survive reopening and reconnecting. Task status stays idle, and the local queue remains paused. Saves on one conversation/device cannot insert into another selected context.
- Failed stops retain active steering; rejected/unsupported/uncertain saves retain recoverable hints. The existing remove/restore controls also remove native unconfirmed hint metadata. Other clients' interruption and natural completion keep their recovery behavior.

Verification: 717 full unit/integration tests passed (6,061 assertions, 54 files); 8 focused desktop/mobile browser cases passed; Vue/server typechecks, Vite/PWA build and diff check passed. A real isolated Codex 0.160.0 protocol probe used a fake local inference endpoint; no real inference. Unit and browser cases cover pending acknowledgement/completion order, duplicate Stop, multiple inputs, files/images, native echoes, saved-history recovery, queues, device/view switching and rejected operations. Desktop/mobile stopped-transcript captures were inspected; the scoped mechanical UI check returned no findings. Existing local service health and exact served index/entry bytes matched the build.

Publication: frontend-only application changes; no backend restart is required. The Codex daemon must support the native injection and thread-attachment methods; unsupported versions stop normally and retain messages with a clear error.
