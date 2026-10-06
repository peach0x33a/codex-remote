# Codex Remote

在桌面或手机浏览器中使用自己的 Codex App Server。支持多设备连接、流式对话、任务控制、文件操作与 PWA 安装。

使用 Vue 3、TypeScript、Vite 和 Bun 构建。Bun 提供网页与连接服务，将浏览器接入本机 daemon 的 Unix socket 或远端 WebSocket 地址。

## 功能

- **多设备工作空间**：保存、编辑和切换设备，按项目浏览会话，查看各设备的连接与任务状态。
- **流式对话**：展示回复、思考、命令输出和文件变更，支持 Markdown、代码高亮与复制。
- **任务控制**：停止任务、运行中插话、消息队列、目标管理，以及可按错误类别配置的自动重试。
- **提问与审批**：回答 Codex 的选项或自定义问题，处理命令、文件和权限请求。
- **文件与代码**：添加任意类型附件，浏览远端文件、创建文件或目录、预览静态 HTML，以及查看 Git 变更。
- **会话管理**：搜索、分页读取、归档、恢复、编辑消息、侧聊与分叉，并通过 URL 返回指定会话。
- **外观与移动端**：明暗主题、内容宽度、字体、动效或图片背景、外观导入导出，以及手机键盘适配。
- **安装与登录**：安装为 PWA，缓存应用外壳，并选择是否记住访问密码。

## 快速开始

准备 Bun 1.3.14+ 和 Node.js 22.12+，并在 Codex 所在环境完成模型提供方登录。上传附件和部分远端文件操作需要该设备安装 Python 3；Git 变更操作还需要 Git。

在项目目录安装依赖：

~~~sh
bun install --frozen-lockfile
~~~

### 本地运行

~~~sh
bun run build
bun run start
~~~

打开 [http://localhost:3000](http://localhost:3000) ，然后添加自己的 Codex 设备。默认监听 `127.0.0.1:3000`。

Bun 同时提供 `dist/` 中的页面和 `/api` 连接服务，部署时运行完整的 Bun 服务。

### 开发模式

~~~sh
bun run dev
~~~

打开 [http://localhost:5173](http://localhost:5173) ，Bun 桥接服务运行在 `127.0.0.1:3001`。该命令统一启动、监听改动并关闭两个进程。

自定义开发端口：

~~~sh
WEB_PORT=5174 BRIDGE_PORT=3002 bun run dev
~~~

## 连接 Codex

打开顶栏的设备下拉框，选择“添加设备”，填写名称、App Server 地址和可选的默认工作目录，点击“保存并连接”。

### 本机 daemon

在 Bun 所在机器启动 daemon：

~~~sh
codex app-server daemon start
~~~

将控制 socket 的绝对路径填为 `unix://` 地址，例如：

~~~text
unix:///home/me/.codex/app-server-control/app-server-control.sock
~~~

默认控制 socket 位于 `~/.codex/app-server-control/app-server-control.sock`。设置了 `CODEX_HOME` 时使用对应目录的绝对路径。

### WebSocket App Server

启动 TCP 监听器：

~~~sh
codex app-server --listen ws://127.0.0.1:4500
~~~

在设备配置中填写 `ws://127.0.0.1:4500` 。连接其他机器时，填写其实际 `ws://` 或 `wss://` 地址；启用了传输认证的服务器还需要填写对应的 Bearer token。

设备地址中的 `127.0.0.1` 和 Unix socket 路径都指向 **Bun 所在机器**。从手机打开网页时，填写的仍然是 Bun 能访问的地址。

“访问令牌”用于连接 App Server；网页的“应用访问密码”用于登录 Bun 服务；模型提供方认证由 Codex 所在环境管理。

### 连接链路

~~~text
浏览器 / 已安装的 PWA
  → 同源 Bun 连接服务
  → Unix socket 或 ws/wss
  → Codex App Server
~~~

Bun 负责上游连接的 `Authorization` 请求头和 `Origin` 要求。浏览器使用一次性短时连接凭证接入桥接服务。

## 使用

### 消息与任务

选择设备和工作目录后，可以创建新对话，或从侧栏打开已有会话。默认工作目录为 `~/codex-remote`，首次在该目录创建会话时会在设备上准备目录。

| 操作 | 方式 |
| --- | --- |
| 发送消息或向运行中的任务插话 | `Enter` |
| 换行 | `Shift + Enter` |
| 在任务运行时加入待发队列 | `Tab` 或队列按钮 |
| 打开输入命令菜单 | 行首输入 `/` |
| 提及文件 | 输入 `@` |
| 翻阅已提交输入 | 输入框边界处按上 / 下方向键 |
| 打开待回答问题 | `Shift + ←` 或“回答问题”按钮 |
| 从问题返回输入框 | `Shift + →` |

运行中可以选择模型、思考强度和权限，设置应用于后续请求。`/fast` 切换快速模式，`/compact` 压缩上下文，`/goal` 管理目标与 token 预算；目标功能需在 Codex 端启用 `goals`。

点击“停止生成”后，已接收但尚未写入会话的插话会依次加入记录，任务保持停止。消息队列可查看、编辑、移除或取回草稿，保存位置由队列界面显示。

消息下方提供编辑和撤回入口。撤回会移除该轮及后续会话记录；已经执行的命令和文件修改仍保留在设备上。

### 提问、审批与重试

Codex 提问时，输入框上方显示待回答入口，支持选择选项或填写自定义答案。审批请求也在输入区显示，提交失败会保留回答草稿。

在“设置 → 网页设置 → 失败与重试”中开启自动重试，选择错误类别、重试间隔和连续次数上限。失败后显示倒计时，可随时取消；未发送的草稿会保留，手动停止的任务保持停止。

手机上的错误提示占用完整内容宽度，重试操作位于提示下方的右侧。

### 附件、文件与变更

点击输入框左下角 `+` →“添加文件”，或粘贴、拖入附件。支持任意文件类型，按文字与附件的顺序发送。文件上传到当前 Codex 设备的私有临时目录，显示进度并支持取消；上传完成后加入草稿。

顶栏文件夹按钮打开文件浏览器，可切换目录、设为工作目录、新建文件夹或文件。静态 HTML 文件支持页面预览和源码查看。

会话中的文件变更可展开查看 diff。变更面板支持本轮补丁、工作区、暂存区、提交与分支比较，并提供完整本轮补丁的撤销和重新应用。

任务中心集中展示近期会话。会话详情可以查看子代理、打开其会话，或返回父会话。地址栏中的 `device` 和 `thread` 参数用于刷新、收藏或分享指定会话。

### 外观

侧栏底部的“设置”提供主题、内容宽度、自动换行、字体与字号、背景、通知和音效选项。手机上先打开导航。

背景可使用动效、纯色、上传图片或 HTTP/HTTPS 图片地址，并调整不透明度、模糊和颜色效果。“外观与背景”支持导出和导入 JSON，上传图片会嵌入导出文件；字体名称使用目标设备已安装的字体。

## 保存与登录

设备名称、地址、默认目录、所选设备和每台设备最近 100 条已提交输入保存在 Bun 服务端。同一部署的浏览器共享设备配置与输入历史，网页外观偏好保存在当前浏览器。

“记住令牌”默认开启，将 App Server 令牌保存在私有凭证文件中。取消后仅在当前页面内存中使用。已保存的令牌可保留、替换或清除，移除设备时同时清除。

设置了 `APP_ACCESS_KEY` 的部署需要先登录。“记住密码”默认开启，在当前浏览器保持登录 30 天，关闭页面或重启 Bun 后仍可恢复。浏览器保存 HttpOnly 登录凭证，服务端只保存与访问密码绑定的凭证哈希。退出登录会撤销凭证；修改访问密码后需重新登录。

关闭“记住密码”使用浏览器会话 cookie，服务端有效期最长 12 小时。HTTPS 登录的 cookie 带有 `Secure` 属性。

凭证文件默认位于 `.local/credentials.json`，权限为 `0600`，通过原子写入保存。使用 `APP_CREDENTIALS_FILE` 可指定持久存储路径；容器部署时挂载其所在目录，并放在 `dist/` 之外。

会话由 App Server 保存。PWA 缓存应用页面、字体和图标；连接、读取会话和模型执行需要网络。

## 部署与 PWA

应用是供自己的可信设备使用的单用户工作空间，各客户端共享后端访问权限。

### HTTPS 部署

在项目根目录的 `.env` 中配置域名和访问密码：

~~~dotenv
HOST=127.0.0.1
PORT=3000
APP_ORIGIN=https://codex.example.com
APP_ACCESS_KEY=replace-with-a-long-random-password
~~~

将域名和密码替换为自己的配置，然后构建并运行 Bun 服务。Caddy 配置示例：

~~~caddyfile
codex.example.com {
    reverse_proxy 127.0.0.1:3000
}
~~~

### 局域网访问

使用本机局域网地址配置监听和允许来源：

~~~dotenv
HOST=0.0.0.0
PORT=3000
APP_ORIGIN=http://192.168.1.20:3000
APP_ACCESS_KEY=replace-with-a-long-random-password
~~~

将示例 IP 替换为本机地址。非 loopback 监听或公开域名部署需要设置 `APP_ORIGIN` 和至少 16 字符的 `APP_ACCESS_KEY`。

`APP_ORIGIN` 可使用英文逗号分隔多个源，例如同时允许局域网与 HTTPS 入口。每个源包含协议、主机和可选端口。

### 配置项

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bun 监听地址 |
| `PORT` | `3000` | Bun 服务端口 |
| `APP_ORIGIN` | 本机的 localhost 与 127.0.0.1 地址 | 允许访问应用的源，可用逗号分隔 |
| `APP_ACCESS_KEY` | 本机部署可不设置 | 应用访问密码 |
| `APP_CREDENTIALS_FILE` | `.local/credentials.json` | 私有持久存储文件 |
| `APP_ALLOWED_HOSTS` | 不限制 | 允许连接的上游主机名，可用逗号分隔 |
| `ALLOW_UNIX_SOCKETS` | `true` | 是否允许 Unix socket 连接 |

完整示例见 [.env.example](.env.example)。

### 安装为应用

Chrome / Edge 使用页面的“安装应用”或浏览器安装入口；iPhone / iPad 使用 Safari 的“分享 → 添加到主屏幕”。远程设备安装需要 HTTPS，localhost 可直接用于本地安装。

首次联网打开后会缓存应用外壳，离线仍可打开界面。导航下方的更新提示提供手动更新入口。

## 验证

~~~sh
bun run typecheck
bun run test
bun run build
bunx playwright install chromium
bun run test:e2e
~~~

测试覆盖协议状态、认证与私有存储、跨设备隔离、任务和队列、文件操作及桌面 / 手机交互。浏览器测试使用独立的 mock bridge、daemon 和测试凭证文件。

需要保留当前运行服务的构建产物时，可指定测试构建目录：

~~~sh
bun ./node_modules/vite/bin/vite.js build --outDir .local/e2e-dist --emptyOutDir
E2E_STATIC_DIR=.local/e2e-dist bun run test:e2e
~~~

设置 `CHROMIUM_PATH` 可使用已有 Chromium。`E2E_PORT` 和 `MOCK_PORT` 可配置测试端口，默认分别为 `14731` 和 `14501`；登录测试还使用 `E2E_PORT + 1`。

只读验证指定 daemon 的协议连接：

~~~sh
bun scripts/smoke-daemon.ts unix:///absolute/path/app-server-control.sock
~~~

默认读取初始化结果、模型与会话列表；加上 `--history` 可验证历史分页读取。

## 项目资料

- [产品约定](PRODUCT.md)
- [视觉约定](DESIGN.md)
- [实现研究](docs/research.md)
