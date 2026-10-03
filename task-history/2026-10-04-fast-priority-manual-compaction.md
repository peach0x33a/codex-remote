# Fast Priority toggle and manual context compaction

Date: 2026-10-04

Request: use /fast to toggle Priority; expose a lightning button at the reasoning panel top left; add /compact and a context-window compression button.

Implemented: service-tier completion maps priority to /fast while retaining the real wire ID. Slash command and reasoning lightning share the serviceTier setting, with null for off and priority for on (legacy fast supported). The previously fast-only lightning button now recognizes priority. Added native thread/compact/start request with connection, active conversation, busy/loading/revision guards, failure feedback and existing contextCompaction notification rendering. Added the full-width context-window button, disabled during work or without an active session. No user text or synthetic generation is submitted for compression.

Validation: 171 related unit tests (977 assertions), four desktop/mobile browser tests; Vue/server typechecks, isolated Vite/PWA build, git diff --check, live HTML/service worker/entry asset hashes. The initial browser fixture attempted to interrupt a short mock turn after it had already completed; corrected it to wait for natural completion. All final checks passed. Mock protocol validation does not perform a paid live model compaction.

Release: frontend 955fd61; backend remains 1f36f43 with PID 527090, no restart. Auth and saved credentials preserved; release metadata and frontend rollback location in .local/deployment.json. Not pushed to origin.

Official interface references: https://learn.chatgpt.com/docs/developer-commands and https://learn.chatgpt.com/docs/app-server; installed generated ThreadCompactStartParams accepts threadId only.
