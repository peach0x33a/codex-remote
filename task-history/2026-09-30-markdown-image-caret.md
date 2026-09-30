# Markdown, pasted-image caret, and project selector fixes

Date: 2026-09-30, Asia/Singapore.

## Request

Fix literal Markdown bold delimiters shown around Chinese labels; allow typing after pasting an image; move project/working-directory selection above the input box.

## Changes

- Reproduced the native Markdown parser behavior for Chinese punctuation-ending strong labels immediately followed by CJK text. Added a narrow post-inline compatibility rule for unresolved text tokens, including closing-marker padding. Code spans/blocks, escaped delimiters, URL destinations, HTML sanitization and remote-image suppression stay intact. The sanitized public renderMarkdown entry point remains unchanged.
- Added explicit editable caret positions on both sides of non-editable image chips. Image insertion focuses an editable text position; asynchronous image reads retain their insertion range; preview-close restores the editing selection. Owned caret markers are excluded from serialized prompt text. Backspace/Delete handle adjacent image chips without trapping the cursor in a recreated marker.
- Moved the working-directory selector outside the bordered composer, immediately above it. Updated the existing directory test selector and documentation.
- Added Markdown unit cases and five editor/browser regressions, covering actual paste events, immediate typing without refocus, middle insertion, Backspace, layout position, and rendered bold labels.

## Validation

- Production build and Vue/TypeScript checks pass.
- Unit suite: 22 pass, 0 fail, including Markdown/code/escape/link/security compatibility and prior runtime tests.
- Chromium launch was attempted without a network listener, but the current sandbox denied setsockopt and Chromium exited with SIGTRAP. No escalation or bypass was attempted. Browser regression definitions are present, but keyboard/paste interaction has not been revalidated in a browser in this environment.

Files: src/lib/markdown-engine.ts, src/lib/markdown.ts, src/components/PromptEditor.vue, src/components/QueuePane.vue, src/App.vue, src/style.css, tests/unit/markdown.test.ts, tests/e2e/editor-regressions.e2e.ts, tests/e2e/final-controls.e2e.ts, tests/mock-daemon.ts.
