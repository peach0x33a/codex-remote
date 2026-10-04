# Unblocked application update banner

Date: 2026-10-04

Requests: stop gating the application update action on task, revision and queue state; keep only duplicate-request protection and retry.

Implemented:
- UpdateBanner drops its `disabled` prop entirely. Applying an update is an explicit user action; a running task, pending revision, saving Goal, applying change or open queue draft no longer blocks it.
- The banner text keeps a single availability message ("新版本可用。") instead of the task-blocked variant. The button remains disabled only while its own request is in flight, keeps `aria-busy` and the spinner, and surfaces a retryable error toast on failure.
- App.vue no longer computes the activity-derived `disabled` expression for the banner. No other banner or notice logic changed.
- DESIGN.md and README.md updated: the update region is independent of task/revision/queue state, and only duplicate requests are suppressed while a request is processing.

Validation: `bun run typecheck` (vue-tsc + server tsc) passed. 682 full unit/integration cases passed (5,889 assertions, 51 files). The focused `tests/unit/tool-activity.test.ts` case was rewritten to assert that the button is enabled while work is running, that duplicate clicks during an in-flight request make only one call, and that a failure restores the enabled button for a real retry.

Publication: not deployed in this session — no Vite/PWA build, no backend restart and no browser cases were run. Deployment and browser verification remain outstanding for this change.
