# 2026-10-01 — Rebuild and publish the merged main branch

## Request
Recompile the application and trigger its update.

## Completed
- Built production assets from master code commit 2226a80; Vue/server typechecks passed.
- Published the staged Vite/PWA build to dist, keeping four previous hashed assets available for already-open clients.
- Saved the previous dist at /home/peach0x33a/source/repos/apps/codex-remote/.local/releases/20261001-234630-before-2226a80.
- Gracefully stopped the old Bun listener (2451759) and started the updated server (3125155) with the same executable, arguments, working directory and inherited environment. The same .env and credential-file configuration remain in effect.
- The service is detached; its PID is recorded in .local/server.pid and output is in .local/server.log. It is not managed by tmux. No App Server/model task was started or stopped by verification.

## Verification
- GET /api/health returns ok:true on the original 127.0.0.1:3000 listener.
- GET /api/profiles succeeds (200); only response shape/count was inspected, not raw stored secrets.
- Session authentication policy matches the previous process.
- Served index.html and sw.js exactly match the published build; both return Cache-Control: no-cache.
- index.html SHA256: 4351aec215e8b9fccb99b205bbadcfd397b4ff3f7e5620bf4ebfea8415f4114c
- sw.js SHA256: 48d7433098e03243063381c750e79e212685cfcc7c05e5e5a84fc9238d6d684f
- The service-worker revision differs from the previously deployed revision. New update resources are available to clients.
- Browser inventory contains no connected browsers or app tabs, so no existing user tab was clicked or force-reloaded. A LAN HTTP page loads the release on refresh; a registered PWA can detect the new worker at its next update check and use its update button.

No production application source changes were needed. No remote Git push occurred.
