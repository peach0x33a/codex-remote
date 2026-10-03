# Navigation placement, file-browser entry and entry-point audit

Date: 2026-10-03
Requests: place the full-width error strip below navigation; add a file-browser entry; check other existing capabilities for missing entries.
User clarification: named commands count as first-level menu entries. Having /goal, /diff, /skills or /mention is sufficient; do not classify those as missing merely because there is no additional button.
Application commit: ac18bc179c231657ca20363a26bf2a7890a0b7eb.

## Implementation

- Moved the existing error strip immediately below .workspace-header. It retains its full width and zero outside margin/radius.
- Added a persistent folder button labeled 文件浏览器 to the header. It opens the current conversation cwd or home-screen working directory; disconnected/loading states disable it. It also toggles the file panel closed. Opening it dismisses competing inspector/changes panels; applying a patch blocks the action.
- File reads for absolute and ~/ paths no longer require the configured working directory to exist. Missing directories retain parent navigation, including ~/codex-remote -> ~. Downloads use the resolved absolute file path independently of cwd. No mkdir or thread/turn start occurs from browsing.
- Header layout keeps controls clickable at 320–1440px. At <=360px the duplicate search/new icons in the left capsule yield to navigation; sidebar search/home and /resume, /new remain available.

## Audit criterion and result

Buttons, menus and the 20 named slash commands were traced from their visible/declarative entries to handlers and feature components. Input-history keys and contextual message controls count as entries in their appropriate context. Unused presentation primitives and unavailable upstream features are not independent working capabilities.

The missing standalone capability was directory browsing, now fixed. No additional independent capability without a usable button/menu/command entry was confirmed under the user's criterion. The earlier wording calling Goal, Git changes, skills and mentions missing/hidden entries is withdrawn. No redundant buttons were added for those features.

| Capability | Existing entry |
| --- | --- |
| New conversation | Header/home/project controls; /new |
| Find/resume conversation | Sidebar/header search; /resume |
| Rename, archive, pin, fork, side chat, separate window | Conversation actions; /rename and /archive where applicable |
| Archived conversations / restore | Sidebar 归档会话 |
| Devices / credentials / disconnect | Device picker and edit dialog |
| Files / directories | New header 文件浏览器; existing message file links continue working |
| Model / effort / permissions / service tier | Composer controls; /model, /effort, /permissions and supported tier commands |
| Skills / file, plugin, agent and thread mentions | /skills, /mention, $ and @ completion categories |
| Goal create/manage/status | /goal and its supported arguments; existing Goal row controls |
| Git changes / worktree / index / commits / branches | /diff; contextual file summaries/details; scope menu inside viewer |
| Context / Session ID copy | Context usage control; /status |
| Working directory | Composer directory picker; /cd, /project, /pwd |
| Task center | Header grid; /agents, /tasks |
| Website/Codex settings, typography, appearance, notifications | Sidebar settings; /settings; settings navigation |
| Copy code/reply/conversation | Block/reply buttons, conversation copy submenu; /copy |
| Queue / steer / approvals / retry / stop / edit / withdraw | Contextual composer/island/message controls |
| Output creation / subagent details | Conversation inspector |
| Installation / help | Sidebar installation/help; /help |

Scope: source-level feature/entry tracing, with sampled browser interaction. It does not claim every upstream feature was exercised live. The existing side-chat file preview is a reuse of the file capability, not a separate implementation; side-chat protocol generation was covered by the existing regression cases.

## Verification

- Full unit/integration run: 658 passed, 5,669 assertions, 50 files.
- Final Vue/server typechecks and Vite/PWA production build passed; existing large-chunk warning remains.
- Final four-file browser run: 36 cases passed across desktop/mobile (file navigation/previews/downloads, composer commands/Goal, native queue controls and thread actions).
- New directory entry regression covers disabled-before-connect, active cwd, child/parent navigation, focus return, missing default cwd -> remote home, absence of creation/generation RPCs and cwd-independent reads. An initial wrong test label for the home button was corrected before the passing run.
- Bounded UI review: four light/dark desktop/mobile file-panel captures; four real connection-error banners; ten header geometry/hit-target checks at 320,390,768,1024,1440px. The initial narrow-header overlap was fixed, then all confirmation checks passed. /goal and /diff opened their existing panels in the browser.
- Mobile uses Chromium emulation. Review scratch artifacts: .local/entry-review, .local/nav-files-banner-review, /tmp/codex-nav-files-review.png. All scratch servers and browser contexts stopped.
- git diff --check passed. No new permanent cosmetic tests were added.

## Publication

Published at 2026-10-03T19:25:01.787096+08:00. Frontend ac18bc1; backend b2266f5. Bun PID 3102363 was unchanged, without restart. Existing requiresKey=false state, environment and device credential file were preserved.

Previous frontend: /home/peach0x33a/source/repos/apps/codex-remote/.local/releases/20261003-192501-before-ac18bc1
Retained hashed assets: 37
Metadata: .local/deployment.json
HTML SHA256: 761b8603ff6f2a735ef78c15629b3b86c3392de54e7790af429806afa86450a8
Service worker SHA256: 9f749fd01f2aa11da24890a55c012b54416dcd42325df70acacb7f0b2c72249f

Live listener, health, auth state and exact served HTML/service-worker/entry-asset hashes were verified. No remote Git push was performed.
