# 2026-10-02 — Mobile keyboard avoidance

## Request and diagnosis
The mobile software keyboard covered the composer because the shell/mobile workspace remained sized to 100dvh while only the visual viewport shrank. The existing menu positioners already observed VisualViewport, but the shell and composer entrance animation did not.

The incumbent bug was reproduced against the previous deployed dist: shrinking only the simulated visual viewport left the input behind a visible keyboard overlay. Baseline screenshot: /tmp/codex-keyboard-before.png. The pre-fix regression failed as expected.

The Impeccable adapt workflow was used for this narrow responsive fix. Existing PRODUCT.md still has outdated browser-device-storage prose; current source and the user's server-storage requirements remained authoritative, and that unrelated context drift was not repaired.

## Final changes
- Added useVisualViewport to coalesce resize, pan and focus geometry into animation frames, fit the shell to visible height/offset, restore prior root styles on unmount, and leave pinch zoom native.
- Enabled interactive-widget=resizes-content where supported, with VisualViewport and window-resize fallbacks.
- Cancelled composer entrance animation when viewport geometry changes, so an old animation cannot drag the input back beneath the keyboard.
- Resized mobile side chats, navigation, native dialogs, goal/settings dialogs, approval content and floating menus against the visible area. Menus reposition after the shell geometry update.
- Compact composers remain scrollable and constrained by their parent and available height; focused input/form can scroll into view without changing focus, selection or draft.
- Mobile editable fonts stay at least 16px to avoid automatic input zoom. Existing colors, controls and conversation behavior remain.
- Conversation readers above the bottom retain their reading position; only an already-following conversation continues following the latest content.

## Verification
- 648 unit/integration tests pass, 0 failures, 5,519 assertions.
- Typecheck and production Vite/PWA build pass; existing large-chunk warning remains.
- Full Chromium desktop/mobile suite: 94 pass (4.2 minutes).
- Final compact-parent-height adjustment: all 10 keyboard-targeted desktop/mobile cases pass again (21.8 seconds).
- New cases exercise visual-only shrinking, viewport panning, dismissal, zoom preservation, portrait/landscape side chat, reader-position preservation, absent VisualViewport, and editable goal dialogs.
- Light and dark screenshots of the fixed composer and a keyboard-constrained goal dialog were reviewed. No additional visual-polish loop.
- Evidence is synthetic VisualViewport events and real browser layout/input assertions. It is not a physical Android/iPhone IME test, nor an actual Safari device test. Those hardware behaviors remain unverified.
- Logs: /tmp/codex-keyboard-before.log, /tmp/codex-keyboard-unit.log, /tmp/codex-keyboard-types.log, /tmp/codex-keyboard-final-build.log, /tmp/codex-keyboard-final-browser.log, /tmp/codex-keyboard-confirm.log.
- Browser behavior references: https://developer.chrome.com/blog/viewport-resize-behavior/ and https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport

## Publication
- Published code: b7df274 on master at 2026-10-02T02:35:15.011147+08:00.
- Published the final tested .local/keyboard-final build to dist, retained prior hashed assets, and backed up the old dist to /home/peach0x33a/source/repos/apps/codex-remote/.local/releases/20261002-023515-before-keyboard-layout.
- Only static frontend resources changed. Backend PID 3888293 remained unchanged, preserving application login sessions and live transports.
- Health is ok. Served index.html and sw.js hashes match the published build and return no-cache; the worker revision changed. Deployment details are in .local/deployment.json.
- No remote Git push.
