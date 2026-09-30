# Work duration and stable background during sidebar transitions

Date: 2026-09-30, Asia/Singapore.

## Request
Append execution time to Codex 正在工作. Fix the animated background jump caused by sidebar width changes.

## Implementation
- Added typed server turn startedAt/completedAt (Unix seconds) and durationMs fields, verified against local generated Turn bindings.
- The working status shows elapsed seconds/minutes for the active turn. The shared clock now runs throughout active work, including tool execution. Server start time takes precedence; missing metadata falls back to a per-device/thread/turn observation cache. Switching between threads preserves fallback timing. Completion stops the timer and a new turn starts fresh.
- Kept retry, context compaction and separate reasoning timing semantics intact.
- HeroBackdrop shader/grid canvases use viewport-sized drawing coordinates, offset to compensate for workspace position. Parent clipping reveals/hides the backdrop during sidebar transitions without resetting noise/grid geometry. Backing dimensions are assigned only when they actually change.

## Files
shared/protocol.ts; src/composables/useCodex.ts; src/App.vue; src/style.css; src/components/HeroBackdrop.vue; tests/unit/runtime-state.test.ts; tests/e2e/appearance-revisions.e2e.ts; DESIGN.md; CURRENT_STATUS.md; dist/.

## Verification
- bun run build: passed, including type checks and PWA assets.
- bun test tests/unit: 41 passed, 0 failed, 158 assertions. New cases cover ticking without reasoning, thread switching, turn reset and remote start timestamps.
- Browser regression added for stable canvas dimensions/origin while toggling the desktop sidebar; mobile is skipped because its drawer overlays rather than resizes the workspace.
- Browser execution/visual verification remains unavailable in the previously established environment. No live conversation mutation or publication performed.
