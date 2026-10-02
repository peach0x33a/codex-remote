# Markdown syntax highlighting

Date: 2026-10-02
Request: 代码块的高亮呢。
Application commit: b6de9a0454d377ccc9c268106a8a77b8bfb3b23c (local master).

## Changes

- The shared Markdown renderer now uses a syntax-highlighting hook. highlight.js 11.12.0 is locked in bun.lock; the common bundle plus Dockerfile and PowerShell provides 38 language grammars. Existing aliases (JS/TS/TSX/Python/etc.) and Vue/Svelte/Astro/Shell/Zsh mappings are supported.
- CSS maps highlighted keywords, strings, numbers, titles, attributes, comments, variables and diff tokens to existing light/dark syntax tokens. Theme changes only change colors. Geometry, copy buttons and original text remain unchanged.
- Highlighter input is raw text, generated HTML still passes through the existing sanitizer, and copying reads code.textContent. Unknown/unlabeled code remains escaped plain text; there is no language auto-detection during streaming.
- Blocks above 20,000 UTF-16 code units fall back to full escaped text without truncation. A 64-entry/500,000-code-unit bounded LRU cache avoids repeatedly highlighting completed blocks. Errors also fall back to escaped text.
- DESIGN.md records the shared Markdown highlighting conventions.

## Verification

- Full unit/integration suite: 658 passed, 0 failed; 5,669 assertions across 50 files.
- Vue and server typechecks passed; Vite/PWA production build passed. The existing large-chunk warning remains.
- Eight targeted desktop/mobile Chromium browser cases passed: highlighted streamed code and exact copying, theme switching, plain-code fallback, Markdown file previews, HTML sanitization, and existing HTTP Session ID copy behavior. The full browser suite was not rerun.
- Unit cases exercise representative languages/aliases, original text preservation, malicious/unknown language hints, unsafe HTML, oversized fallback, partial streaming and cache eviction.
- Four current-build desktop/mobile light/dark captures were visually reviewed. Mobile testing uses device emulation, not hardware.
- git diff --check passed.

## Publication

Published at 2026-10-02T14:26:19.006711+08:00. Frontend b6de9a0; backend b2266f5. Bun PID 274217 remains on port 3000 with no restart, preserving active connections and login sessions. Previous hashed assets retained: 29. Environment and credential file hashes remain unchanged. Health, authentication requirement, live listener and served entry assets were verified.

Previous frontend: /home/peach0x33a/source/repos/apps/codex-remote/.local/releases/20261002-142618-before-b6de9a0
Metadata: .local/deployment.json
HTML SHA256: 2bdd35bfea65746c4ff952d667fc48c3f3a50652a57be6c8a66e5cada647ac7a
Service worker SHA256: 967cf7e1f464754f87540bd07d2a6647d2a7ecc92b23801b4f79c0cb94486631

Refresh or use the existing PWA update flow to load the new frontend. No remote Git push was performed.
