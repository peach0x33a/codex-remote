# Markdown code-block copy controls

Date: 2026-10-02
Request: 代码块没有复制按钮。
Application commit: 3787046d172d2eb8bcf033bbec2fa38f8ba43391 (local master).

## Changes

- The Markdown renderer previously emitted only pre/code, without per-block controls. Fenced and indented blocks now have a language label and an always-visible copy button. Inline code remains inline.
- Shared event delegation copies only the current block text, including indentation, tabs, spaces, newlines and literal HTML. It covers main/side-chat messages, reasoning, plans and Markdown file previews through the existing rendering components.
- Existing clipboard handling and success/failure toasts are reused, including the HTTP fallback. No popup or auto-selection UI was added. Restoring a selection now precedes restoring focus, preventing Chromium from moving keyboard focus back into the editor after fallback copying.
- Code shells and buttons use existing spacing/radius/theme tokens. Buttons have a 44px minimum target and remain in place while code scrolls horizontally.

## Files

src/lib/markdown-engine.ts, src/lib/markdown-code.ts, src/lib/clipboard.ts, src/components/MessageItem.vue, src/components/WorkspaceFilePanel.vue, src/style.css. Focused fixtures and regression checks live in tests/markdown-fixture.ts, tests/mock-daemon.ts, tests/unit/markdown.test.ts and existing app/file-links browser suites.

## Verification

- Final full unit/integration run: 655 passed, 0 failed; 5,603 assertions across 50 files.
- Vue/server typechecks and Vite/PWA production build passed. Existing large-bundle warning remains.
- Initial three-file browser run passed 34 existing cases and exposed a fallback focus defect plus a detached-node race in the streaming test. Both were corrected. Final targeted run passed all six desktop/mobile cases covering code copying, file-preview copying, and existing Session ID HTTP fallback/no-popup behavior.
- Exact copy coverage includes streaming partial/final content, multiple blocks, non-Latin text, escaped HTML, empty blocks, indentation/trailing whitespace, keyboard activation, failed clipboard access, and horizontal scrolling.
- Reviewed four desktop/mobile light/dark captures. Mobile evidence uses Chromium device emulation, not physical hardware. No additional visual changes were required.
- git diff --check passed. The complete browser suite was not rerun for this narrow change.

## Publication

Published at 2026-10-02T14:08:46.919809+08:00 to the existing service on port 3000. Frontend commit 3787046; backend remains b2266f5. PID 274217 was unchanged, with no restart or login-session reset. Retained 25 previous hashed assets for open clients. Environment and credential file checks remained unchanged.

Previous frontend: /home/peach0x33a/source/repos/apps/codex-remote/.local/releases/20261002-140846-before-3787046
Deployment metadata: .local/deployment.json
Served HTML SHA256: 6f03c0aca766038f7a365b6a18f7781dc0e6fad8d8b6e4aa625e4a11371f2e2d
Served service-worker SHA256: 1af332888e1f3a59bba28a9a5b33b89553e16b2920075eab7738b2359b646998

Health, authentication requirement, live listener, exact served HTML/service-worker and entry asset hashes were verified. Normal browser refresh or the existing PWA update flow loads the change. This task did not push Git commits to the remote.
