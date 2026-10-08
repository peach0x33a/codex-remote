# 会话内容与文件预览补齐

用户要求实现上一轮列出的六类缺口。保留工作树中已有的上游错误恢复修改，未回退其他任务的改动。

实现：

- 历史 `localImage` 和带显示地址的图片使用会话设备读取、缩略图与放大预览。工具结果支持 MCP 内容块、动态工具内容、函数调用输出和生成图片；支持文本、图片、音频、资源链接，并保留未知块及原始结果。
- `audio`/`localAudio` 可以播放，保留历史、编辑、重发、输入历史和停止插话中的原始来源。编辑器中的音频使用音频播放器，而非图片预览。没有自动播放。
- Markdown 支持 KaTeX 公式、只读任务列表和 Mermaid。图表使用 SVG 文本标签、严格模式、图片资源过滤、源码披露和复制；不完整的流式内容有回退提示。图表源码经过 URI 编码存入惰性占位符，避免箭头被 HTML 净化器移除。
- 远端文件支持净化后的 SVG、PDF 翻页和音频。图片上限 8 MiB，PDF/音频上限 32 MiB，超过上限保持下载。读取使用已有文件指纹、分块、取消和路径校验。SVG 去除脚本、嵌入 HTML、外部图片与外部样式资源；PDF 使用本地打包的 PDF.js canvas，限制页面像素与尺寸，切换时取消旧绘制。密码 PDF 提示下载原文件查看。
- MCP elicitation 进入原有请求浮岛，支持标准文本、整数/数字、布尔值、单选、多选、默认值和字段校验。提交保留实际类型，拒绝/取消显式返回各自的 action。URL 模式只在用户点击时打开页面，完成确认另行提交；服务器请求未被自动接受或拒绝。草稿保留在请求草稿中，错误在修改字段后清除，底部操作可在滚动表单中保持可用。
- Bun 的页面 CSP 允许实际媒体播放、本地 PDF worker/字体与受限 WebAssembly；仍禁止普通 JavaScript eval、内嵌页面脚本和 object 嵌入。PDF 的 CMap、标准字体和解码资源由 Vite 从安装依赖复制到忽略的生成目录；按需缓存并按依赖版本区分缓存，不用外部 CDN。更新后端并重启，才会应用新的 CSP。

限制：

- 只有孤立 `fileId`、没有 URL/path/内容的图片，现有 App Server 接口无法下载。保留标识并明确提示，不猜测路径、不调用未定义 RPC、不读取模型提供商凭据。
- 不声明支持 OpenAI 扩展嵌套表单；无法完整校验的字段或规则明确阻止提交，仍可由用户拒绝或取消。没有开启扩展表单 capability。原生设备验证不是标准表单，显示明确限制。
- PDF 是静态页面预览，不执行文档 JavaScript，不提供编辑或填表。

验证：

- `bun run build` 通过，包含前后端类型检查及 PWA 构建。
- 全量单元/集成测试 796 项通过；随后追加 PDF/音频 32 MiB 边界测试后，文件读取 33 项通过。最终相关表单、工具内容、Markdown 和浮岛测试 45 项通过。
- 桌面和手机浏览器回归共 22 项通过，覆盖媒体、图表、公式、任务列表、SVG 资源净化、PDF 实际页面像素和翻页、MCP 表单实际返回值/显式取消、图片显示、代码复制、队列与附件编辑。
- 追加两端原生音频编辑、图表解码和表单交互 6 项通过；截图检查发现 Mermaid 12 的全局 `htmlLabels` 优先于旧 flowchart 设置，已切换全局 SVG 文本并加入标签内容断言。
- 最后对图表文字、PDF 取消绘制和 PWA 离线壳复测，两端共 6 项通过。浏览器截图检查涵盖两端图表、PDF 与表单。
- 图表采用 viewBox 的自然尺寸，避免两节点图被拉伸到整屏；两端再次通过媒体/图表测试。表单整体未知规则及无效长度限制的补充校验测试通过，最终构建通过。
- `git diff --check` 通过。测试进程单独移除环境代理变量，未修改用户代理设置。

协议与库文档：

- [App Server MCP elicitation 和动态工具](https://learn.chatgpt.com/docs/app-server)
- [Mermaid 用法和严格模式](https://mermaid.js.org/config/usage)
- [KaTeX 配置](https://katex.org/docs/options)
- [PDF.js 接口](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)

本机生成绑定 `/tmp/codex-remote-user-input-schema.q0cBPR` 用于核对 audio/localAudio、MCP enum 变体、imageGeneration 和函数调用内容字段。未把这些临时生成文件纳入项目。
