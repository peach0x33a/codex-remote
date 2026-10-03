# Pasted text label cleanup

Date: 2026-10-03

Request: remove the literal brackets around pasted-text bubbles.

Removed outer square brackets in PromptEditor.vue and PastedText.vue; aligned README. Character-count label and native input placeholder parsing remain compatible.

Verified: bun run typecheck; isolated Vite/PWA build; git diff --check; live HTML, service worker and two entry asset hashes; health/auth and saved credentials preserved. Frontend 2822c29 published with no backend restart (backend 1f36f43, PID 527090). No new tests for this cosmetic change.
