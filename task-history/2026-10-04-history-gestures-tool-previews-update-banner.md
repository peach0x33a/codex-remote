# History gestures and conversation presentation

Date: 2026-10-04

Requests: automatically load older conversation history after repeated upward attempts; center the manual control; flatten read-file groups to a count and vertical paths; allow users to view imageView files; restore the update entry as a navigation banner; show one-line completed reasoning inline with its icon.

Implemented:
- useHistoryScroll counts two deliberate older-direction attempts at the top (24px boundary, 1.6s window), merges wheel bursts within 180ms and requires 32px gesture distance. Passive wheel/touch handlers preserve native scrolling. Reverse motion, leaving the boundary, unavailability/loading and view changes reset intent. One request at a time; explicit fresh gestures permit retry.
- Earlier loading preserves a visible message anchor, falls back to height offset when needed, and ignores a replaced device/thread/view. The manual control is centered with a 44px minimum target.
- Pure-read groups count unique native paths and expand directly into a vertical list. Commands/output/errors remain in execution-detail disclosures without repeated filename headings.
- imageView records expose a named image button and full path, opening the existing bounded remote file preview on the conversation device. Main and side-chat openFile handlers already share that capability. Missing files retain retry/error controls; unknown items keep readable fallback. Added the native optional image path to the structural protocol type only.
- UpdateBanner replaces the header icon/tooltip with a full-width, square-edged notice below navigation, using the error region's geometry. Updates remain manual; active tasks/changes and duplicate clicks are blocked, with progress and retry.
- Completed single-line reasoning renders the sparkle icon, sanitized Markdown and native duration inline. Multi-line reasoning stays collapsible. Live and blank reasoning remain absent from the transcript; unit testing caught and corrected a branch fallthrough into raw JSON.

Validation: 674 full unit/integration tests, 5,800 assertions across 51 files; 28 focused desktop/mobile browser checks including gestures, inertia, retry, exhaustion, anchoring, stale responses, remote image preview and keyboard/PWA regression behavior. After the final reasoning guard fix, four exact-build browser cases passed (streaming and tool/reasoning previews). Final typechecks, Vite/PWA build and diff check passed. Desktop/mobile centered controls and flat-file/image-preview captures were inspected. Browser mobile coverage is emulated. Test fixture fixes retained strict assertions: the error is a role=alert banner, mobile wheel events are dispatched explicitly, read summaries are a two-element list, the mock exposes file reads for the tool-preview scenario, and desktop navigation uses the existing home entry.

Publication: frontend f276f68 at 2026-10-04T02:06:52.808796+08:00; backend remains 1f36f43, actual Bun PID 527090. No backend restart. Live health, auth, exact HTML/SW/entry asset hashes and saved credentials verified. Release/rollback paths: .local/deployment.json. Changes committed on local master; no origin push.
