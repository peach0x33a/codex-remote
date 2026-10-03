# Session URLs and live turn state

Date: 2026-10-03

## Request and result

Fix a historical unfinished turn resurrecting a 1373-minute working clock and interfering with sends. Include session identity in the URL so refreshes and shared URLs restore the intended conversation.

The live-turn ID now owns the clock, Stop, steering and dispatch guards. Resume derives it from the newest turn metadata rather than any older inProgress record. Old items and native historical durations remain intact, genuinely long active turns remain active, and an idle status notification alone cannot clear a known running turn.

Canonical URLs contain device and thread query parameters. Restoration waits for authentication and server profiles, takes precedence over saved device selection, and rejects stale responses after manual navigation. Failed targets retain their URL for retry; new conversations clear it. Pending IDs, credentials and endpoints are excluded. Existing notification links migrate to the canonical parameters.

## Implementation and verification

Code commit: ca30a2bb2e267b7c6f81744b86d7b3b072da8cb7. Primary files: src/composables/useCodex.ts, src/composables/useSessionUrl.ts, src/lib/session-url.ts, src/App.vue, tests/unit/runtime-state.test.ts and tests/e2e/session-url.e2e.ts.

661 full unit/integration tests passed, plus 106 desktop/mobile browser cases. Final refinements passed 197 focused runtime/device/side-chat tests and six exact final-build URL/state browser cases. Typechecks and Vite/PWA build passed. An isolated authenticated bridge check covered delayed profile loading, manual navigation during a delayed resume, and legacy notification URLs, with zero generation requests and zero page errors. Mobile coverage was emulated.

Published frontend at 2026-10-03T22:14:03.165989+08:00, retaining backend b2266f5 and Bun PID 3102363 without restart. Exact HTML, SW and entry-asset hashes, cache policy, health and auth state were verified. Previous frontend: .local/releases/20261003-221403-before-ca30a2b. This release has since been superseded by the composer/history release recorded separately.

## Limits

URL updates use replaceState and do not create a conversation-by-conversation browser navigation history. No remote generation or repository push was performed for this release.
