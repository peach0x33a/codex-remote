# Background preferences and dark animated welcome

Date: 2026-09-30, Asia/Singapore.

## Request
Add background settings, custom background uploads, a way to disable the light animated background, and equivalent motion for dark mode.

## Implementation
- Display menu includes animated/image/plain choices for the currently resolved theme. Light and dark modes are persisted independently; old preferences migrate to animated defaults.
- Dark welcome background uses the existing shader with a blue/charcoal palette and adapted grid. Changing the OS reduced-motion preference takes effect without a reload. Hidden pages pause; switching modes/unmounting releases animation resources.
- JPG/PNG/WebP uploads up to 20 MB are decoded and resized to at most 2560px, with filenames and raster Blobs saved in IndexedDB. No image is sent to the server. Upload decoding/storage errors are handled; storage-denied images remain usable for the session with explicit feedback.
- Custom backgrounds appear across the workspace. Ongoing conversations get a stronger readability mask; solid controls and theme-aware text colors stay legible. Animated mode keeps the existing welcome-only scope.
- Replace/remove, reload restore, same-browser preference synchronization and object-URL cleanup are implemented. Uploaded image is shared, while theme modes remain independent.

## Files
src/lib/backgrounds.ts; src/lib/ui-preferences.ts; src/composables/useAppearance.ts; src/components/BackgroundSettings.vue; WorkspaceBackground.vue; HeroBackdrop.vue; DisplaySettings.vue; src/App.vue; src/style.css; tests/unit/ui-preferences.test.ts; tests/e2e/appearance-revisions.e2e.ts; DESIGN.md; CURRENT_STATUS.md; dist/.

## Verification
- bun run build: passed including Vue/TypeScript and PWA assets.
- bun test tests/unit: 39 passed, 0 failed, 149 assertions.
- bun run test:e2e --list: 80 desktop/mobile cases discovered. New cases cover theme-specific modes and upload/reload/removal; the image fixture has generated valid PNG CRCs.
- Browser execution remains unavailable under the previously confirmed environment restrictions. Upload rendering and animation have not been visually verified; listed E2E cases are not claimed as executed.
- No real conversation actions, commits or publication performed.
