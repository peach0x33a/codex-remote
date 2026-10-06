# Automatic retry settings and mobile error actions

Date: 2026-10-05

Requests: frontend settings for automatic retry on terminal request failures, with enable/disable and selectable error categories; place the mobile Retry button at the bottom right to avoid a permanent empty action column.

Implemented:
- Add 网页设置 → 失败与重试 using the incumbent settings controls. Browser-local preferences default off; default selected categories are network, server and rate limits. Other categories, including the screenshot's cyber-policy failure, are individually selectable. Delay options are 3/5/10/30/60 seconds and continuous automatic retry limits are 1/3/5/10 attempts.
- Preserve structured failure metadata for classification. Confirmed failed turns use the existing continuation request, `继续`, with current settings. Show a countdown and cancellation action; count automatic failure chains and stop at the configured maximum. Explicit Stop and native ongoing retry notifications never create an automatic continuation.
- Bind timers to the selected device/thread and live connection, cancel on manual input/preferences/view change/disconnect, preserve the composer draft, check native latest-turn state before submission, and pause ambiguous dispatch results. A browser lease helps avoid duplicate work in other tabs. Historical errors do not restart merely because the page reloads.
- Side chat uses the same structured failure and countdown controls. Mobile error descriptions take the full row, and trailing Retry/cancel actions align at the bottom right with touch targets preserved.

Validation: 749 full Bun unit/integration tests passed (6,151 assertions, 55 files); 16 focused desktop/mobile browser cases passed. Cases cover preference persistence, categories and legacy errors, selected/excluded policy failures, default-off/native retry behavior, cancel/cap, unsent draft preservation, stale/native activity, preflight cancellation and browser claims, plus previous Stop/steering and appearance settings flows. Vue/server typechecks and Vite/PWA build passed. Scoped Impeccable detector returned no findings. Desktop/mobile settings and long failure captures were inspected; browser geometry assertions verify the mobile button is below the full-width error message and aligned right.

Publication: the local generated frontend is served by the existing Bun service; no backend restart or external publication is required for this frontend change.
