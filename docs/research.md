# Implementation research

## Automatic retry and mobile failure controls (2026-10-05)

- Official error/lifecycle guidance: https://learn.chatgpt.com/docs/app-server . Native `willRetry` indicates server-managed retry; terminal turn failures carry `codexErrorInfo` and optional `additionalDetails`. The locally generated 0.160.0 `CodexErrorInfo` union supplies the category names, including transport failures with HTTP status, rate/usage/context limits, server errors, cyber/misalignment policy, auth and request errors.
- Remote retains structured failure metadata and schedules browser-local continuation only after a confirmed `failed` turn. The opt-in setting chooses categories, delay and a finite consecutive attempt limit. Missing older metadata uses message classification. Explicitly interrupted turns and ambiguous transport submissions do not enter automatic retries.
- Countdown and dispatch are bound to the visible runtime, device, connection and failed turn. A native latest-turn read rejects stale activity before sending `继续`; browser lease checks reduce duplicate work across tabs. The feature does not modify model, permissions or the original server explanation. Disabling/cancelling, manual input, view/device switching and disconnect cancel future retries. Historical failures on reload remain manual unless the user changes the setting for the selected failed turn.
- Mobile failure controls move into a trailing action row so the message uses full width. Browser assertions measure that the retry button lies below the description and aligns with the right edge.

## Stop and record pending steering (2026-10-05)

- Official App Server: https://learn.chatgpt.com/docs/app-server . `thread/inject_items` appends raw Responses items to the model-visible history without starting a user turn. The 0.160.0 generated schema also provides `thread/attachment/add/list/remove`, with independently persisted JSON payloads and stable type/identity keys.
- An isolated real 0.160.0 App Server with a loopback fake Responses endpoint confirmed that interruption can drop an acknowledged pending steer. Raw injected user messages do not project into `thread/items/list`; native thread attachments do persist the structured original input. The probe made one fake model request before interruption and no further model request after injection. All probe threads were test-owned; no real model generation was used.
- Remote waits for stop completion and pending steer acknowledgements, checks native user items for each source turn, then reserves a stable thread attachment before each raw insertion. A separate commit receipt makes confirmed messages restorable; an uncertain reservation is never automatically injected again. Each input is injected separately to keep WebSocket messages bounded. A fresh current-turn check prevents appending during a later turn.
- The display uses completed local projections anchored after the explicitly stopped turn, retaining original `UserInput` ordering and UI placeholders. These are not in-progress turns. Inline image inputs remain image content in the injected context; local files/images and skills keep their paths accessible to subsequent Codex work. External interruptions and natural completions keep the prior recoverable-hint behavior.

## Arbitrary file attachments (2026-10-05)

- Official App Server documentation: https://learn.chatgpt.com/docs/app-server . Local CLI 0.160.0 `UserInput` bindings expose text, images/local images, audio, skills and mentions, with no general-purpose file union member. General files therefore use text references with native `text_elements` placeholders; raster images too large for an inline message also carry a native `localImage` path.
- The host upload uses the existing `command/exec` interface with fixed Python source, isolated Python startup, and separate argv. Byte chunks are 256 KiB; Base64 argv segments are at most 64 KiB. Transfers do not depend on a new project's working directory already existing and stay on the RPC connection captured at the start of the batch.
- The helper creates a private, unique temporary directory, uses exclusive/no-follow creation and exact offsets, and publishes a file only after the expected length is written. It treats uploaded contents as bytes and does not execute them. Rejected or uncertain chunk writes are not automatically retried. History contains file references and UI labels, excluding uploaded binary contents.
- Unit verification executes the real upload helper and compares resulting bytes. Browser fixtures also execute the source actually sent by the production bundle; the test fixture identifies it by its fixed marker, because bundler Unicode escaping can change the literal source representation while retaining Python behavior.

## Async question adaptation (2026-10-05)

- Official App Server documentation: https://learn.chatgpt.com/docs/app-server . Active-turn replies use `turn/steer` with `expectedTurnId`; an idle thread uses `turn/start`.
- Installed CLI 0.160.0 experimental bindings were generated into `/tmp/codex-remote-user-input-schema.q0cBPR`. `ThreadItem.agentMessage` carries `delivery: "async"` and `questions: AsyncUserInputQuestion[] | null`; each question has a `title` and optional/null string `options`. These are distinct from blocking `item/tool/requestUserInput` server requests.
- A real CLI TUI connected to an isolated loopback WebSocket fixture displayed `shift+← to answer` and `shift+→ main prompt`. Captured answer input used `<send_user_message_question_reply>` around a JSON array of `{ answer, question, questionItemId }`. The ID is JSON-encoded `["request_user_input_async", messageId, originalQuestionIndex]`. The literal captured payload is preserved in `tests/unit/async-questions.test.ts`.
- Remote sends the native tagged answer through its existing steer/start pipeline, waits for acknowledgement before dismissing a pending question, and reads matching native reply records during history hydration. Ordinary untagged steering does not resolve an async question. Question reply display hides the transport wrapper and question IDs.

Sources checked before implementation on 2026-09-30 (Asia/Singapore). Local installed Codex CLI: 0.159.0.

## Codex protocol and daemon

- Official App Server: https://learn.chatgpt.com/docs/app-server (redirect from https://developers.openai.com/codex/app-server/). JSON-RPC request/response IDs; initialize then initialized; thread/start, thread/resume, thread/list; turn/start and turn/interrupt; item deltas and explicit server-request approvals. WebSocket transport remains experimental.
- Official CLI: https://learn.chatgpt.com/docs/developer-commands?surface=cli . Managed remote-control enrollment is distinct from a custom protocol client.
- Locally verified commands: `codex app-server daemon --help`, `codex app-server daemon start --help`, `codex app-server --help`. Daemon start has no TCP --listen flag; support its Unix control socket rather than inventing a daemon TCP command. Standalone TCP listener: `codex app-server --listen ws://127.0.0.1:4500`.
- Canonical local types inspected via `codex app-server generate-ts --out /tmp/codex-remote-schema`; protocol fields match the installed CLI, not guessed chat-completions endpoints.
- Upstream rejects Origin headers. Transport auth uses an Authorization Bearer header. Browser WebSocket cannot set that header: use an authenticated, same-origin Bun bridge. Transport tokens are separate from OpenAI API credentials.

## Browser and PWA

- Browser WebSocket constructor: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket
- Installability, manifest, icons, HTTPS or localhost: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable
- Bun WebSocket server: https://bun.sh/docs/runtime/http/websockets
- PWA caches only the static application shell. API responses, tokens, and conversation history are not service-worker cached.

## Reference and copy

- https://www.deepseek.com/ : accessible official reference for restrained blue branding, generous white space, and direct Chinese calls to action.
- https://chat.deepseek.com/ : requested reference; automated web fetch was unavailable. Do not claim pixel-exact reproduction.
- Original copy: “让灵感，接着发生。” / “连接你的 Codex，把想法变成下一步。” / “连接你的第一台设备” / “地址保存在此浏览器，访问令牌仅用于当前页面。”
- All connection and thread statuses derive from actual protocol state. No fabricated response times, models, conversations, or daemon availability.

## Installed composer, goals and conversation summary (2026-09-30)

- Installed ChatGPT/Codex 26.928.20755 archive: `/home/peach0x33a/.local/opt/chatgpt/26.928.20755/usr/lib/chatgpt/resources/app.asar`, extracted read-only reference under `/tmp/codex-remote-reference`.
- `webview/assets/local-conversation-summary-panel-artifacts-section-696a72ddb44b.js` (`Ti`) and `app-initial-41d268a90bf8.js` (`Oei`, `wCn`): output creation offers document/presentation/spreadsheet/site and appends a plugin-targeted prompt to the composer; it does not submit or immediately create anything. This web adaptation appends a plain task prompt, preserving existing input, because desktop-only plugin identifiers are not part of its connection contract. The desktop outputs section also covers generated images, sites, Drive/AppGen and PR artifacts; recorded file changes alone are not a complete artifact inventory.
- The installed summary list shows six subagents initially, with additional entries on request. Agent IDs provide stable identity; names/roles/model and status come from actual thread metadata. Viewing details and interacting are separate operations.
- Completed-turn file summaries show three rows initially and expand on request. Desktop undo/reapply uses a host `apply-patch` operation with reverse/conflict handling. `thread/revert` only rewrites conversation history and cannot implement filesystem undo.
- Local Rust source `/home/peach0x33a/workspace/codex/codex-rs/tui/src/bottom_pane/chat_composer.rs`, `insert_selected_path`: file completion inserts a path into prompt text, quoting whitespace and placing a separator. It is not a fabricated file `mention` wire object. App Server `fuzzyFileSearch` takes query, roots and cancellation token; the client searches the active device cwd with cancellation and a bounded result count.
- Experimental bindings `/tmp/codex-remote-schema-experimental/v2/ThreadGoal*.ts` and `app-server/src/request_processors/thread_goal_processor.rs`: goal get/set/clear and updated/cleared notifications exist behind the goals feature. Setting an active goal may immediately start or inject work; do not also call turn/start. A null budget retains an existing budget rather than clearing it.
- `v2/CommandAction.ts` distinguishes read/listFiles/search/unknown. Only server-declared read actions establish a file-read group. Adjacent different operations and conversation/turn boundaries remain separate. Native add/delete file-change diffs can contain raw file contents; only validated unified hunks establish line-change counts in this adaptation.


## Native changes panel, queue and terminal errors (2026-09-30)

Read-only reference: installed ChatGPT/Codex 26.928.20755, app.asar and byte-matched extracted bundles under /tmp/codex-remote-reference/webview/assets. No installed application or codex-rs source was changed.

- pull-request-code-review-3525d04c8e84.js: xr toolbar, Er More, dr jump-to-file, gna refresh, Cr/wr unified/split/auto, bc file tree. The file/search icon searches file paths; it is not content search. Panels narrower than 625px move secondary controls into More. Native rich-preview/word-diff/hide-imports/full-file settings were inspected but are not implemented as fake web buttons.
- thread-side-panel-tab-content-34c29874cd43.js and app-initial-41d268a90bf8.js: last-turn uses recorded turn diff; uncommitted means HEAD to worktree, unstaged means index to worktree, staged means cached. A selected commit compares first parent (or empty tree for a root); branch uses merge-base(selected base, HEAD) to current worktree, including uncommitted changes. Web commit/ref lists are intentionally bounded.
- Native undo uses host apply-patch with reverse/conflict handling, not thread/revert. The web adaptation checks complete patches and working-file snapshots before git apply -R; it intentionally leaves the index unchanged. It is not native staged-diff undo parity.
- codex-rs/tui/src/bottom_pane/chat_composer.rs and tui/src/app/thread_routing.rs: Enter during active execution becomes turn/steer; Tab queues. input_flow.rs and turn_runtime.rs allow draining after observed ordinary completion/failure, while interrupted or unconfirmed submissions require different handling. ext/queue owns daemon dispatch. Native TUI's local queue preview still does not render the daemon queue.
- app-shared-bedb2212942c.js HXn hides errors marked willRetry and unwraps an exact JSON error.message response. Terminal error text and request identifiers remain visible inline. App Server has no turn/retry request: the web retry button explicitly sends a continuation to the failed conversation, without rerunning individual tool commands or replacing the user's draft.
