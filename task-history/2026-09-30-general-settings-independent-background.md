# General settings, independent backgrounds and auto-connect

Date: 2026-09-30, Asia/Singapore.

## Requests and delivered behavior

- Switching light/dark/system no longer changes the selected background mode or image opacity, blur, overlay color or strength. Animated backgrounds still use the theme palette.
- Expand the existing dialog into general settings: connection, appearance, background and content width. Rename the entry/title to “设置” and remove the theme-specific background label.
- Add a persisted “自动连接” switch, enabled by default. Open/reload connects the last saved device after app authentication. Disabled startup preserves devices for manual connection. Manual disconnect cancels startup intent, including a late authentication response. Existing transport reconnection for an established session is unchanged.

## Implementation

- src/lib/ui-preferences.ts: global backgroundMode, imageBackground and autoConnect. Retain the storage key; migrate legacy per-theme values once from the current appearance. Preserve unrelated preferences, avoid rewriting malformed storage and tolerate failed persistence.
- src/composables/useAppearance.ts: theme-independent background refs, migration using the actual OS preference, shared image effects, upload/remove and cross-tab synchronization.
- src/composables/useCodex.ts: one-shot authenticated startup connection with cancellation on manual disconnect.
- src/components/DisplaySettings.vue, BackgroundSettings.vue, src/App.vue: general settings layout, keyboard-accessible switch, wiring and shared image reset.
- tests/unit/ui-preferences.test.ts, new appearance-state.test.ts, runtime-state.test.ts: persistence/migration, reactive appearance behavior and startup connection regressions.
- E2E appearance/settings cases updated for shared backgrounds; startup auto-connect toggle/reload case added. README, DESIGN and CURRENT_STATUS describe the new behavior.

## Verification

- bun test tests/unit: 275 passed, 0 failed, 1739 assertions across 12 files.
- bun run build: passed, including Vue and server/test TypeScript checks. Rebuilt dist and PWA assets; main bundle 533.56 kB, existing non-fatal size warning remains.
- bun run test:e2e --list: 112 cases discovered across 6 files; discovery is not browser execution.
- Browser/TCP integration remains unverified under the previously observed restricted listener/Chromium environment. No claim of a new live service or full browser regression run. No commit or push requested.
