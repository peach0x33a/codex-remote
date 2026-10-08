# Codex Remote

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who run their own Codex App Server or local daemon and want to manage its conversations from a desktop or phone browser. The interface is Chinese-first and can be installed as a PWA.

## Product Purpose

Let users connect to their chosen Codex environment, send tasks, follow streamed work, answer questions and approvals, and return to existing conversations. Connection, conversation and task state come from the actual service.

## Positioning

A browser client for the user's existing Codex App Server. A same-origin Bun bridge connects browser WebSockets to authenticated ws/wss endpoints or local Unix sockets, allowing the web interface to work with multiple named devices and their server-managed conversations.

## Operating Context

The user runs a Codex App Server or daemon and a Bun service that serves the frontend and connection API. The bridge handles the upstream transport's authentication and Origin requirements. Unix socket paths and loopback endpoint addresses refer to the machine running Bun. Public deployments require allowed application origins and an application access password; the default bind is loopback.

The primary workflow is to save a named connection, connect, choose a working directory, select or create a conversation, submit a task, follow progress, and handle requested input. Users can switch devices or conversations and restore the selected device/thread from its URL. The PWA caches the application shell; remote work and history access require a connection.

The implementation uses Vue 3, TypeScript, Vite and Bun. Development and production commands are recorded in [README.md](README.md) and [package.json](package.json).

## Capabilities and Constraints

- Stream messages, reasoning, commands and file changes; inspect server-reported context usage and choose supported models, reasoning effort and permissions.
- Offer browser-local, opt-in automatic continuation after selected confirmed turn failures, with configurable error categories, delay and attempt limit. Keep a cancellable countdown, preserve unsent drafts, and keep explicitly stopped work stopped. A connection or ambiguous submission failure does not authorize automatic replay.
- Resume and paginate conversation history, search recent sessions, archive or restore conversations, and edit or withdraw supported user messages through the server's history operations. Reverting conversation history does not undo filesystem effects.
- Choose the task center's conversation activity range: 2, 7 or 30 calendar days from the latest activity, all time, or explicit inclusive dates. Show the actual interval, remember the choice per device in the browser, and allow bounded history reads to continue on demand. Filtering and inspection are read-only until the user opens a conversation.
- Interrupt running work, steer an active turn, manage pending messages, and use supported server goals. Native queues are shared through the daemon; the fallback queue is explicitly limited to the current page.
- Answer blocking permission requests and questions, and open async questions while Codex continues working. Async questions support suggested choices and custom answers, retain drafts on rejection, and recover pending questions from conversation history.
- Accept attachments of any file type without extension or MIME filtering, preserve their order with text and images, and retain file references through queues, editing and input history. Stream uploads to a private directory on the selected Codex host before adding them to the draft; support progress, cancellation and recoverable failure. Uploads use Python 3 and remain available until the host's temporary storage is cleared.
- Support skills and file mentions, browse remote workspace files, preview supported files, and inspect Git changes. HTML preview is static and sandboxed. Uploading a file does not execute it.

Device profiles, the selected device and accepted input history are persisted by the Bun service. Users can choose whether to remember an upstream transport token; remembered tokens are stored in the private server-side credential store, while unremembered tokens remain in session memory. Browser appearance preferences are local and can be transferred through an appearance export that excludes connection credentials.

The application login offers a remember-password choice, enabled by default, which keeps an opaque HttpOnly login credential for 30 days. Only password-bound credential hashes persist in the private Bun store, so remembered login survives service restarts. Explicit logout revokes it; changing the application access password invalidates existing credentials. Disabling the choice uses a browser session cookie with a maximum 12-hour server lifetime. The browser stores the choice, never the application access password.

Codex transport tokens are distinct from model-provider API credentials. Model-provider authentication belongs to the Codex environment. The client respects server permissions and capability availability; unsupported operations report their limitation explicitly. The web client does not start, stop or upgrade the daemon. Standard MCP elicitation forms and explicit URL confirmations are supported; fields that cannot be validated remain blocked with an explanation and user-controlled decline/cancel. Client-provided dynamic tool execution and native device attestation are outside the current implemented scope.

## Brand Commitments

The product name is Codex Remote. Keep its independent branding and Chinese-first, direct interface copy. DeepSeek is the established interface reference. Preserve the existing logos and icons; detailed visual rules belong in [DESIGN.md](DESIGN.md).

## Evidence on Hand

- [README.md](README.md), [docs/research.md](docs/research.md) and task records in `task-history/` document implemented workflows, protocol research and scoped verification.
- `src/`, `server/` and `shared/` contain the working client, Bun bridge and protocol contracts; `public/` contains the existing application assets.
- `tests/unit/`, `tests/integration/` and `tests/e2e/` cover runtime state, persistence and browser workflows. Mock daemon data is synthetic test content and must not appear as real user sessions or product proof.

There is no product record establishing customer testimonials, commercial pricing or performance benchmarks. Future work must not invent them.

## Product Principles

- Show actual connection, task and conversation state; derive capabilities and usage figures from the server.
- Keep approvals and question answers explicit user actions and honor the server's permission policy.
- Preserve drafts and distinguish rejected submissions from uncertain results; do not silently replay uncertain work.
- Keep private connection data out of browser preferences and static assets; make persistence choices clear.
- Keep the core workflow usable with desktop keyboards and mobile touch controls.

## Accessibility & Inclusion

Support Chinese input methods, labeled controls, keyboard navigation and focus restoration, responsive touch layouts, and reduced-motion preferences. Browser automation includes desktop and mobile emulation; it does not establish physical-device validation or a formal accessibility certification.
