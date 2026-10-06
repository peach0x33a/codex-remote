# Arbitrary file attachments

Date: 2026-10-05

Request: extend attachment support, with the user's explicit clarification that file type, extension and MIME must not be restricted.

Implemented:
- The main file selector accepts all types and is labeled 添加文件 / 选择附件. Selection, clipboard files and drops use the same reader across the main composer, queue editor, message revision editor and side chat.
- Arbitrary files are streamed byte-for-byte to the selected Codex host, with progress and cancellation. No application file-size or file-type allowlist is added. Native command frames and individual argv values remain bounded. The captured connection and cancellation guards prevent stale batch work from moving to another device.
- Private unique upload directories, exclusive creation, no-follow opens and exact-offset acknowledgements keep incomplete uploads out of the draft. Filenames cannot overwrite existing files or become shell code. Uploaded files are not executed.
- Native text placeholders preserve filenames, paths, sizes, device binding and mixed content order. Larger raster files also use localImage to retain native vision input without large WebSocket frames. Queue/edit/history round-trips preserve attachments.
- The composer shows removable filename/size chips. File removal works from the keyboard and has a 44px target on coarse pointers. Sent messages, pending steers and collapsed queue rows expose file icons, sizes and explicit preview actions. Transport metadata is hidden in messages and session previews.

Verification: 703 unit/integration cases passed (5,979 assertions, 53 files), Vue/server typechecks and Vite/PWA build passed, and 18 focused desktop/mobile browser cases passed. Unit cases execute the actual Python helper and compare binary bytes, verify empty/unsafe names, uncertain writes, cleanup, native image routing and history/device binding. Browser cases cover arbitrary types, paste/drop, keyboard removal, cancellation, rejection, queues, edits and reload/recall, plus the existing image, caret, queue and revision flows. Desktop/mobile captures were inspected. The mechanical UI check has one existing Markdown blockquote-border warning outside the attachment changes. Existing local service health and exact served index/entry bytes matched the build; no backend restart or external publication was performed.

Storage: remote private temporary files; queues/history retain references, so clearing the device's temporary storage requires reattaching those files. Python 3 is required, matching the current file-browser environment.
