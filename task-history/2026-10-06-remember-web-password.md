# Remember Web UI password

Date: 2026-10-06

Request: add a remember-password choice to Web UI login.

Implemented:
- Add a default-on 记住密码 switch to the existing login dialog, with the shared 44px control and a concise 30-day/explicit-logout explanation. Store only the browser's choice locally. Keep failed password input available for correction, and disable login controls while verification is pending.
- Remember authenticated login for 30 days through an opaque HttpOnly / SameSite=Strict cookie, Secure on the allowed HTTPS origin. Persist only HMAC-SHA256 credential hashes bound to the configured application access password, through the existing private atomic credential store. No application password is persisted in browser or server records.
- Restore remembered sessions before handling authenticated requests after service restart. Rotate tokens on a new login, revoke the replaced token, and durably remove remembered login on logout. Changing APP_ACCESS_KEY makes old cookies invalid. Turning the option off uses a browser session cookie with a maximum 12-hour server lifetime.
- Preserve stored device profiles, upstream credentials and input history. Bound remembered records, prune expired records on mutations, and refuse malformed/unsafe storage. Persistence failure does not issue a remembered cookie; failed logout remains retryable.

Validation: 761 full Bun unit/integration tests passed (6,241 assertions, 57 files). Four login cases per desktop/mobile cover refresh and new browser contexts, cookie lifetime and privacy, opt-out preference, real logout, incorrect password correction, keyboard access, loading and duplicate-submit prevention. Six existing desktop/mobile session-URL cases passed. Vue/server typechecks, Vite/PWA build and diff checks passed. The scoped Impeccable UI detector returned no findings; independent review of final desktop light/mobile dark captures required no material fixes. Mobile navigation attachment checks include hidden controls until the actual logout helper opens navigation; geometry assertions account for subpixel animation rounding.

Deployment preflight used the running service's original configuration and a private copy of its credential file. Remembered login survived a bridge restart, logout succeeded, and existing profiles/credentials/history were unchanged. Rollback backend/static assets were prepared before publication. Live publication verification is recorded in CURRENT_STATUS.md and the private local deployment record.

Publication: updated the current local frontend/backend at 2026-10-06T01:26:01Z, with Bun PID 1399410. Retained the running service's host, port, origins, access password and credential path. Live health, exact index/entry/service-worker bytes, authentication configuration, remembered cookie lifetime and logout revocation passed. Temporary private environment/preflight copies were removed. Source publication to origin/master is separate from this local rollout.
