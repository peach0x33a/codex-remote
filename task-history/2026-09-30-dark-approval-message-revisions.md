# Dark appearance, composer island, and message revisions

Date: 2026-09-30, Asia/Singapore.

## Implemented

- Appearance menu: light, dark, and system; persistence preserves content width and other stored preference keys. Root-level theme tokens cover teleported popovers/dialogs. The bright welcome backdrop is omitted in dark mode.
- Composer island: the project selector rests on a quiet shelf attached to the input. Pending permission or Ask requests replace the project slot with exactly one card. Arrows navigate; successful resolution advances to the next remaining request; unfinished answers survive navigation. Failed submission does not remove the card. Advancing restores focus to a neutral group rather than arming an action.
- Project picker: search, folder rows, selected check, add-project path entry, and no explicit project/default-server-directory action. No permanent path form or stacked overlays.
- User message edit and withdraw: real thread/revert calls, retained-history hydration, optional revised resend, explicit effect description, and stopping the running turn first. Existing queued messages are retained and paused. Unsupported servers do not get a client-only fake deletion. A turn containing multiple user inputs is only reverted through its first user input. Already executed commands/filesystem changes are not undone. Edited content is recovered after a committed revert followed by send failure.
- Reasoning: textual object fragments and strings are normalized; empty final snapshots retain prior visible text. Records without body content show a factual availability note rather than an empty accordion. No missing content is fabricated.

## Verification

Final Vue/TypeScript checks and production build pass. Unit suite: 34 pass, 0 fail, 125 assertions. This covers themes/preferences, approval selection transitions, reasoning normalization, remote image attachment references, withdrawal, earlier-turn editing, server rejection, stopping and pausing a queue, rejection of unsupported within-turn partial reverts, and resend failure.

Playwright successfully lists 76 cases across four files. Browser execution remains unverified for these changes under the current restricted environment; earlier Chromium attempts were blocked by the sandbox. No live user conversation was reverted as part of testing; revision tests use the real RpcClient/useCodex path with an in-memory server fixture.

Three delegated agents returned 429/retry-limit errors; the parent implemented and validated the changes directly, then closed the failed agents.

## Main files

src/composables/useAppearance.ts, src/lib/ui-preferences.ts, src/lib/approvals.ts, src/components/ApprovalIsland.vue, src/components/ApprovalCard.vue, src/components/DisplaySettings.vue, src/components/WorkingDirectoryPicker.vue, src/components/MessageRevisionEditor.vue, src/components/MessageItem.vue, src/components/PromptEditor.vue, src/composables/useCodex.ts, src/lib/prompt.ts, src/App.vue, src/style.css.

Tests: tests/unit/ui-preferences.test.ts, tests/unit/runtime-state.test.ts, tests/unit/prompt.test.ts, tests/e2e/appearance-revisions.e2e.ts and updated mock/selector fixtures.
