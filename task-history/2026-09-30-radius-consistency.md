# Shared interface radii

Date: 2026-09-30, Asia/Singapore.

## Request
Fix the mismatched hover shape inside the compact header toolbar and unify interface corner radii.

## Changes
- Centralized radii at 4/8/12/16/24px plus a full pill/circle token.
- Applied the scale to global CSS and scoped project list, directory picker, approval island and message edit styles.
- Made icon-only button hover/pressed surfaces circular; balanced the compact toolbar padding and square button dimensions across desktop/mobile.
- Aligned attachment/context/appearance/image-remove icon dimensions to avoid oval hit surfaces.
- Preserved flat joining edges of the attached composer island. Updated animation clip radii to follow the same tokens.
- Updated DESIGN.md and CURRENT_STATUS.md.

## Verification
Production build, including Vue/TypeScript checks, passed. Static coverage finds no non-token border-radius declarations other than intentional 0/inherit. No logic tests were added for this CSS-only task. Browser visual verification remains unavailable under the previously confirmed environment restrictions, so pixel-level browser validation is not claimed.

## Files
src/style.css; src/components/ProjectSidebar.vue; src/components/WorkingDirectoryPicker.vue; src/components/ApprovalIsland.vue; src/components/MessageRevisionEditor.vue; DESIGN.md; CURRENT_STATUS.md; dist/ (rebuilt assets).
