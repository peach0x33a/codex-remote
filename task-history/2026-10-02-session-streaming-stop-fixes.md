# 2026-10-02 — Connection readiness, session controls, streaming and stopped work time

## Requests and final behavior
- Missing default directories no longer gate device connection. The frontend initializes transport immediately and prepares the default directory only before an explicit new conversation/goal. It resolves home on the remote host from an existing root, prefers fs/createDirectory, and falls back to a bounded POSIX command only when that API is absent. Permission failures retain the connection and draft. Changing the configured directory alone no longer disconnects a live device.
- Goals paused, blocked or usage-limited expose Resume. Resuming only sends active status and preserves the objective, counters and budget. Exhausted budgets open editing and require an explicit larger budget before Save and Resume. Completed goals remain non-resumable.
- Session ID is displayed only in Context Capacity with a visible Copy button. Removed its three-dot menu entry and all copy-failure auto-open/auto-select behavior as explicitly requested. Other reply/conversation copy commands remain. The HTTP-compatible clipboard fallback restores focus and selection; failures only notify.
- The old browser-speed warning was a gateway bug: Bun send()=-1 means accepted into its queue, but the previous code disconnected immediately. The bridge now holds subsequent frames in an ordered bounded queue and resumes forwarding on drain. Accepted frames are never replayed.
- Bun 1.3.14's ws pause/resume methods report that they are unimplemented, so the implementation does not rely on them. Application queue plus native pending bytes share a 16 MiB budget with per-frame accounting (including empty frames). Buffers making progress keep draining; 30 seconds without progress, a dropped send, or a real buffer limit closes the connection for resynchronization. This is not a browser throughput measurement.
- Interrupted turns show a frozen “已停止 · 工作了 …” footer at their own end, including tool-only/empty-answer turns and side chats. Native time has priority. A live stop can freeze an observed start/end interval; historical records without sufficient timing are not assigned invented durations. Later optimistic input has its own pending turn and cannot move the previous stop footer below the new message.

## Code and validation
- Earlier readiness/resume changes: bf0870d.
- Latest application commit: 78e46cb.
- 648 unit/integration cases pass, 0 failures, 5,519 assertions across 49 files. Four focused bridge cases cover repeated pressure while draining, exact ordering/no replay, actual drop, combined UTF-8 buffering limits, and progress-aware expiry.
- 84 desktop/mobile Playwright cases pass (4.1 minutes), including directory permission failure without disconnect, constrained-goal recovery/budget editing, Session ID copy/failure behavior, and stopped work time retained after subsequent messages and reload.
- Vue/server typecheck, production Vite/PWA build and git diff --check pass. The existing large-chunk warning remains.
- Logs: /tmp/codex-final-fixes-unit.log, /tmp/codex-final-fixes-types.log, /tmp/codex-stop-copy-pressure-build.log, /tmp/codex-stop-copy-pressure-browser.log.
- Bun's documented send/drain contract: https://bun.com/docs/runtime/http/websockets#backpressure
- Browser tests used synthetic App Server data; no real goal was resumed and no real conversation was interrupted by verification.

## Publication
- Published at 2026-10-02T01:45:46.058398+08:00; code 78e46cb.
- Published the tested frontend artifacts, retained previous hashed assets for in-flight clients, and saved the prior dist at /home/peach0x33a/source/repos/apps/codex-remote/.local/releases/20261002-014546-before-copy-pressure-stop.
- Restarted only the web bridge: PID 3222649 → 3888293. Preserved the live process executable, command, cwd, environment and existing credential-file configuration.
- Health is ok. Served index.html and sw.js hashes exactly match the new build and both return no-cache. The service-worker revision changed.
- Application access-key authentication remains enabled. Its in-memory sessions reset during restart, so clients refresh and log in again. Device metadata and saved tokens remain on the server.
- Listener PID: .local/server.pid; process output: .local/server.log; deployment metadata: .local/deployment.json. No remote Git push occurred.

## Timing limitations
For old history with no native timestamps/duration, a prior client-observed interval cannot be recovered after a full browser reload. Such records show stopped status without a fabricated numeric duration. Server-provided durations continue to survive reload.
