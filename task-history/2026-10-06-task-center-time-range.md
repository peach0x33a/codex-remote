# Task center conversation time range

Date: 2026-10-06

Request: add an explicit time range to the top-right task center so users can select earlier conversations.

Implemented:
- Add a toolbar selector for 2, 7 or 30 calendar days, all time, and custom inclusive dates. Recent presets use the existing latest-activity-day anchor and display their actual date interval. Custom fields require Apply and validate real calendar dates and ordering before changing the active range.
- Persist the applied range per device in browser preferences. Search, state filters, grouping and detail inspection operate on range-scoped results; opening a conversation remains an explicit action.
- Read raw first pages from both interactive and background sources before choosing the range. Continue through newer pages for older custom dates, and stop after crossing the lower date boundary. All-time includes older and undated records. Bounded scans expose a continuation, even when matching conversations have not been reached yet; further reads deduplicate records and retain the selected task. Refreshes preserve the explicitly expanded page budget.
- Cancel pending list/detail reads on range, device or visibility changes and reject late responses. Keep the incumbent desktop list/details layout and responsive mobile controls.

Validation: 769 full unit/integration cases passed (6,288 assertions, 58 files), along with typechecks and Vite/PWA build. Focused desktop/mobile browser tests verify all presets, custom endpoints and validation, persistence, search/grouping, empty ranges and opening an older conversation without generating a turn. Unit cases also cover custom ranges beyond the initial scan budget, continuation, source anchoring, stale responses and a daylight-saving date. Scoped UI detection returned no findings; independent desktop/mobile capture review required no material fixes.

Publication: the combined range/history frontend passed 28 focused desktop/mobile browser cases and was served locally at 2026-10-06T16:24:02Z. Health and exact HTML, entry, task-center chunk and service-worker bytes passed. The Bun backend continues running; the private deployment record retains the previous static build for rollback.
