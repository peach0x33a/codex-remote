# Restored conversation position and continuous trackpad history loading

Date: 2026-10-06

Request: opening previous conversations lands at the older-history boundary, and continued upward scrolling with a Mac trackpad cannot load more history.

Diagnosis: active-thread changes and initial item updates scrolled the loading placeholder to its bottom. Hydration then replaced that placeholder with the transcript without another scroll effect. Separately, the wheel handler counted one attempt per burst and required a 180ms quiet gap, so continuous trackpad strokes could never provide the second attempt.

Implemented:
- Watch device, thread and load completion together. Scroll after Vue has rendered the actual transcript, including reopening the same conversation and URL restoration. Version pending scroll effects so stale selections and streaming updates cannot move the wrong view.
- Accept deliberate sustained upward motion at the boundary as well as separated wheel/touch gestures. Ignore zero-distance wheel noise, recognize renewed acceleration before a momentum tail finishes, and keep a decaying inertia sequence as one gesture.
- Preserve manual history loading, the visible-message anchor after prepend, nested-output scroll handling, cancellation on reversal/loading/view changes, and one request per load.

Validation: the new opening-position browser case failed against the previous build with 5,045px remaining below the viewport, reproducing the reported bug. Desktop/mobile cases exercise latest-message positioning, same-thread reopen and page reload, continuous trackpad events without quiet gaps, decaying momentum and renewed strokes, plus existing manual/touch/anchor/failure/late-response coverage. Typechecks and Vite/PWA build passed. Browser emulation models the event sequences; no physical Mac device was used.

Publication: 28 focused desktop/mobile cases for history, time ranges and URL restoration passed. Independent desktop/mobile capture review required no material fixes. Local frontend publication at 2026-10-06T16:24:02Z passed health and exact served build checks, using the existing Bun backend.
