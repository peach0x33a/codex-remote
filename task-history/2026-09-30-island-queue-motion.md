# Composer island, reasoning states, motion and copy

Date: 2026-09-30, Asia/Singapore.

## Request
- Hide reasoning entries without a body.
- Show context compaction as 压缩上下文中 rather than expandable JSON.
- Integrate queued messages into the composer island and explain why TUI cannot see them.
- Smooth the effort slider and add restrained interface motion.
- Replace the inspirational welcome slogan.

## Implementation
- QueuePane is now a slot within ApprovalIsland, sharing its surface with the project/approval UI. Edit/remove/pause/resume remain available; approval selection still shows one request.
- Empty and whitespace-only reasoning renders nothing. Active compaction replaces the generic working state; finished/failed entries use a compact line. Live events lacking status, history restoration, and interrupted turns are handled.
- Effort slider uses continuous pointer position, discrete supported model settings, and 220ms snapping. Pointer capture, cancellation, focus exit and keyboard stepping are handled. The maximum-effort fill crossfades.
- Menus, queue insertions/removal and request changes have bounded transitions. Existing reduced-motion rules disable spatial effects. Welcome entrance is shortened to 280ms.
- Welcome title is 有什么需要帮忙？ with normal letter spacing.

## Queue transport finding
The real queue is an in-memory per-device/per-thread array in useCodex. Messages are submitted through turn/start only after the active turn ends. Consequently pending browser messages are not present in the TUI queue. The installed generated protocol exposes thread/queue/changed with only threadId, but ClientRequest has no queue read/add/edit/remove methods. No unsupported RPC or steer substitution was introduced. Cross-client queue synchronization is not implemented.

## Files
src/App.vue; src/style.css; src/components/ApprovalIsland.vue; QueuePane.vue; EffortSlider.vue; ComposerPopover.vue; MessageItem.vue; src/composables/useCodex.ts; tests/unit/runtime-state.test.ts; tests/e2e/app.e2e.ts; DESIGN.md; CURRENT_STATUS.md.

## Verification
- bun run build: passed, including Vue/TypeScript checks and PWA assets.
- bun test tests/unit: 37 passed, 0 failed, 139 assertions. Added compaction lifecycle/history and delayed queue-dispatch regression coverage.
- bun run test:e2e --list: 76 cases discovered; existing queue containment and welcome expectations updated.
- Full browser execution/visual validation remains unavailable under the previously established local browser/network restrictions; it was not retried and is not claimed as passed.
- No live conversations were sent, interrupted, or reverted. No commit or publication requested.
