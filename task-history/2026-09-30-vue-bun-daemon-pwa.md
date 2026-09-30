# Vue + Bun Codex daemon PWA

Date: 2026-09-30, Asia/Singapore.

## Request

Build a web application in the current directory, installable as a PWA, where users can save and connect to Codex daemon App Server endpoints. Research official material first. Reference DeepSeek's website/chat interface. The user explicitly selected Vue + Bun after the initial research.

## Work completed

- Read official App Server, CLI, WebSocket, Bun, and PWA material; checked local Codex CLI 0.159.0 help and generated protocol bindings. The chat.deepseek.com reference rejected automated retrieval; the implementation does not claim pixel-exact reproduction.
- Created a Vue 3 / TypeScript workspace, Chinese chat interface, responsive navigation, native connection dialogs, dynamically loaded models, conversation list/search, streaming messages, task interruption, approval forms, and bounded reconnect behavior.
- Created a Bun same-origin bridge with one-use connection tickets, Origin checks, optional application-password authentication, upstream Bearer auth, host allowlist support, TCP WebSocket and Unix transports, and production static serving.
- Added PWA manifest, PNG/maskable/Apple icons, locally bundled fonts, shell-only caching, manual update prompts, offline state and backend reachability feedback.
- Added unit/integration tests, a test-only daemon fixture, desktop/mobile browser tests, and a read-only real-daemon smoke script.
- Added README, PRODUCT.md, DESIGN.md, source research, and current-state handoff.

## Validation results

- bun run typecheck: passed.
- bun run build: passed; 17 precache entries, approximately 447 KiB application shell.
- bun test: 10 passed, 0 failed.
- Playwright: 16 passed, 0 failed across desktop and mobile.
- Real daemon bridge smoke: initialize, model/list, thread/list succeeded over its Unix control socket.
- Real daemon browser smoke: actual UI connected, 15 model dropdown options including the default option loaded, 0 page errors, 0 turns started. No conversation contents were printed.
- Production preview /api/health: HTTP success.

## Compatibility fixes found during testing

- Pinned TypeScript to the 5.9 line for compatibility with the installed vue-tsc; TypeScript 7 exports were incompatible.
- Used ws+unix transport URLs because Bun's ws compatibility layer ignored Node's socketPath option.
- Enabled clientsClaim for first-load PWA control while keeping prompt-based updates.
- Distinguished backend reachability from navigator.onLine, which returned true after offline service-worker navigation in the tested Chromium environment.
- Moved browser specs to .e2e.ts so Bun's default test discovery stays separate from Playwright.

## Handoff

Production preview is running on localhost:3000. Existing services on ports 4173 and 5173 were not stopped. Follow README.md for development, HTTPS deployment, daemon addresses, and token handling. This delivery does not include public deployment, first-party remote-control pairing, older-history message pagination, or general MCP elicitation forms.
