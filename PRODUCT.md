# Codex Remote

A Chinese-first, installable web client for a user's own Codex App Server or local daemon. Built with Vue 3, TypeScript, Vite, and Bun, as requested.

Primary workflow: save a named endpoint, connect, select or create a conversation, send a task, follow streamed output, and answer explicit approvals. Endpoint records live in this browser. Transport tokens remain in memory. No invented sessions or connected states.

The Bun service bridges browser WebSockets to the upstream App Server, because upstream rejects Origin-bearing connections and supports Authorization-based authentication. Support ws/wss and absolute local Unix socket paths. A deployed bridge must be authenticated; the default bind is loopback.

Brand reference: DeepSeek's quiet Chinese chat interface, generous white space, pale sidebar, restrained blue, simple rounded composer. Independent branding, no copied logos or unsupported marketing claims.

Platform: responsive web and installable PWA. Offline use covers app shell and saved endpoints, not remote inference.
