# Compact sidebar and command highlighting

Date: 2026-09-30, Asia/Singapore.

## Request

- Restyle project navigation using the installed Codex/ZCode as references.
- Remove verbose collaboration-tool explanations and absent-data prose.
- Add syntax highlighting to commands under “运行命令”.

## Changes

- Reworked ProjectSidebar.vue and shell styling with neutral selection, 30px desktop rows, 14px titles, shared 8px radii and flatter project indentation. Hover/focus reveals project creation and archive controls; touch layouts retain visible controls and 44px rows. No grouping or archive-guard logic was replaced.
- App.vue opens conversation search from its existing header button. Escape and the close button clear search and restore focus.
- Removed descriptive paragraphs and missing-agent/status placeholders from collab-tool.ts and MessageItem.vue, while retaining actual operation/state/result values.
- Added command-highlight.ts and connected it to expanded commandExecution blocks. Fixed span classes and HTML escaping preserve literal command content without evaluating it. Common zsh/bash wrappers, flags, strings, variables, comments, operators and numbers receive themed colors. Heredoc bodies remain opaque; scripts above 32,768 characters fall back to complete escaped text. Output logs remain text.
- Updated README.md, DESIGN.md and CURRENT_STATUS.md.

## Reference evidence

The installed ChatGPT/Codex 26.928.20755 archive at /home/peach0x33a/.local/opt/chatgpt/26.928.20755/usr/lib/chatgpt/resources/app.asar and ZCode at /opt/ZCode/resources/app.asar were inspected read-only by a delegated worker. Codex desktop rows use 30px height, 14px titles, compact indentation and hover/focus actions. The existing extracted Codex app-initial/app-shared files under /tmp/codex-remote-reference were checked against the installed archive. No installed app files were modified.

## Validation

- bun test tests/unit: 226 pass, 0 fail, 1434 assertions across 11 files.
- The new highlighter suite contributes 13 tests covering escaping, text preservation, wrappers, quoting, variables, heredocs, input bounds and mixed syntax. Existing collaboration tests compile the actual MessageItem component.
- bun run build: passed, including Vue/TypeScript checks and regenerated dist/PWA assets. Main client chunk is 527.21 kB minified; the existing non-fatal size warning remains.
- Current browser UI inventory returned no available browsers. Prior restricted-environment listener/Chromium failures remain; no new visual browser or full E2E pass is claimed. The prior E2E discovery count is 98 cases across four files.

## Boundaries

No daemon/service restart, live model task, commit or push was performed. Production assets have been rebuilt. The prior server queue, recent-session window, command center and composer behavior were preserved. Native TUI queue-list synchronization remains outside these UI changes.
