# Edge-to-edge workspace error banner

Date: 2026-10-03
Request: the top error banner should fill its whole region instead of having outside spacing.
Application commit: d0dcb2cc442dc1d515fef8cb76a2bd9f6fa43136.

## Changes

- Removed desktop and mobile outer margins and rounded corners from .error-banner. Its background spans the workspace width and directly adjoins the header.
- Retained readable inner padding and the dismiss button. Disabled flex shrinking so wrapped mobile error text keeps its full height.
- Updated DESIGN.md to preserve this convention. No connection behavior or error text was changed.

## Verification

Vue/server typechecks, Vite/PWA build and git diff --check passed. Four browser checks reproduced the actual App Server connection error using an isolated bridge and an endpoint that rejects WebSocket connections: desktop/mobile, light/dark. All confirmed workspace-edge alignment, zero margins/radius, adjacency to the header, visible dismiss control, successful dismissal and no overflow/page errors. Screenshots were reviewed. Mobile coverage is Chromium emulation. No permanent test was added or full test suite rerun for the CSS-only change. Existing large-bundle warning remains.

Scratch evidence: .local/error-banner-review/report.json and four screenshots; .local/review-error-banner.ts. All isolated review servers/browser contexts were stopped.

## Publication

Published at 2026-10-03T19:05:30.582501+08:00. Frontend d0dcb2c; backend source remains b2266f5. The actual listener was already PID 3102363 at publication; this task did not restart it. The pre-existing unauthenticated /api/session reports requiresKey=false; no authentication/configuration change was made by this task. Environment and credential hashes remained unchanged.

Previous frontend: /home/peach0x33a/source/repos/apps/codex-remote/.local/releases/20261003-190530-before-d0dcb2c
Retained old hashed assets: 33
Metadata: .local/deployment.json
HTML SHA256: f3189631379e308220a4b1d9259db2ce5cd47b4f18ce512399b00b59ce745c12
Service worker SHA256: 6c3e301e7aafae7031a7685d96ed0f62935fe4c89d2b5575db7cdb3ad51f8194

Health, live listener and exact served HTML/service-worker/entry-asset hashes were verified. No remote Git push was performed.
