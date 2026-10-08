# 内容展示缺口检查与代码块头部压缩

后续实现见 [会话内容与文件预览补齐](2026-10-08-rich-content-support.md)，下面保留当时的检查结果。

范围：用户询问是否还有“内容已收到但未正常展示”的类似缺口，并要求缩小代码块复制栏。此轮只修改复制栏样式，其他缺口为只读检查结果。

已修改：`src/style.css` 去掉代码块头部上下 padding，复制按钮桌面高度改为 32px；粗指针设备保持 44px 触摸目标。默认字号下头部由 52px 降至桌面 32px、触屏 44px。

验证：`bun run build`（含类型检查）、`git diff --check` 通过。桌面和手机的代码复制及 Markdown 图片净化回归共 4 项通过；核对两端明暗主题截图。原先要求完全禁用远程图片的旧浏览器测试已更新为允许图片、仍禁止脚本和 JavaScript 链接，图片请求由测试拦截，不访问外部站点。

发现：

1. 原生历史图片：`src/lib/prompt.ts:61` 读取 `localImage.path`，但展示 URL 只取 `part.url`；`InlineImage.vue` 不加载路径或解析 fileId。原生本地图片或只有 fileId 的图片会显示图标且无法预览。本客户端上传后带文件引用的附件有另一个可用的文件预览路径，不属于同一问题。
2. 工具及生成图片：`MessageItem.vue` 除特定已实现类型外，仅把 `item.result || item.error || item` JSON 化。MCP 返回图片、动态工具 `contentItems` 以及 `imageGeneration` 没有对应媒体视图。类型证据来自本机 `/tmp/codex-remote-user-input-schema.q0cBPR` 生成绑定；本次没有验证每种服务器是否会实际发出这些事件。
3. Markdown 丰富内容：运行现有渲染器确认 Mermaid 作为普通代码、数学公式保留 `$...$`、任务列表保留 `[x]`/`[ ]`，没有对应图表、公式或勾选视觉。
4. 文件预览：远端图片仅识别 PNG/JPEG/GIF/WebP；SVG 按文本显示，PDF 按二进制走下载确认。HTML 预览已经能显示文档内的 SVG，但单独 SVG 无图形预览。
5. 音频输入：本机 UserInput 绑定包含 audio/localAudio，`messageParts` 对它们退化成 `[audio]`/`[localAudio]` 文本，没有播放或原文件打开交互。属于明确的功能缺口，不是已经实现的录音功能发生故障。
6. MCP 表单：`useCodex.ts` 遇到 `mcpServer/elicitation/request` 直接返回 decline。已有明确提示，属于尚未实现的交互能力，可能中断需要补充信息或授权的工具流程。

优先补历史图片和工具输出媒体；随后补 Mermaid/公式等常见内容格式。MCP 表单需要单独设计协议交互和授权流程。以上尚未实施。
