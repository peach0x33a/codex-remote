# 2026-10-01 — 主分支合并与测试精简

## 交付
- 已将 `fix/server-device-sync` 合并到 `master`，合并提交 `d9451d5`；功能提交为 `9eadf8a`。
- 并行完成的文件预览/下载、响应式界面及 Copy Session ID 均保留。合并前的主目录内容保存为 `263ebd6`，恢复分支为 `backup/master-before-device-sync-20261001`。三方合并只有 CURRENT_STATUS.md 需要手工整合。
- 默认 `bun run test`：1,017 → 634 项，包含 609 项单元测试和完整保留的 25 项集成测试。浏览器套件：246 → 78 项，39 个业务场景分别运行桌面和手机配置。
- 实际删除重复用例、等价输入展开、旧客户端测试和无引用 fixture；没有使用 skip、only、改名或测试发现过滤来减少数量。
- 精简阶段不修改生产功能代码。浏览器测试改用独立 mock bridge，固定 loopback 来源和合成凭据，不继承主目录生产 .env 的密码、来源或凭据文件。

## Brooks-Lint Review

**Mode:** Test Quality Review
**Scope:** 合并后的 tests/unit、tests/integration、tests/e2e。
**Health Score:** 85/100（精简前诊断，3 项 Warning）

测试保护了关键业务，但等价输入矩阵、过时展示断言和已退役的客户端测试增加了维护成本。

### Test Suite Map

| 命令/类别 | 精简前 | 精简后 |
|---|---:|---:|
| 单元测试 | 992 / 46 文件 | 609 / 45 文件 |
| 集成测试 | 25 / 3 文件 | 25 / 3 文件 |
| 默认套件合计 | 1,017 | 634 |
| Playwright（含桌面/手机展开） | 246 / 12 文件 | 78 / 12 文件 |

### Findings

#### Warning

**T3 — 等价输入及多层展示重复 [guided]**
Symptom: turn-duration 的 82 个用例反复展开无效时长、消息资格和展示字符串；collab-tool、tool-activity、goal-command 等也重复检查同类枚举、空值及渲染结果。
Source: xUnit Test Patterns — Lazy Test / Test Code Duplication；The Art of Unit Testing — 行为边界。
Consequence: 修改文案或展示结构会触发多个同义失败，数量增加却不同比例增加业务保护。
Remedy: 保留不同执行路径、真实边界、异常/竞争条件和代表输入，移除重复参数及展示检查。继续保留消息顺序、HTML 安全、目标恢复和跨设备隔离。

**T2 — 旧展示假设和乐观 UI 取样导致脆弱断言 [guided]**
Symptom: 部分历史浏览器用例依赖已经替换的控件或任意像素间距；技能发送用例看到乐观消息后立即读取服务端 metrics，偶发得到空提交列表。
Source: Software Engineering at Google — 测试可观察行为；xUnit Test Patterns — Erratic Test。
Consequence: 业务正常也会失败，掩盖真正的协议和状态回归。
Remedy: 删除重复/过时的样式矩阵；保留目标启动/编辑/状态流程，去掉其中无关的 12px 几何断言；技能发送等待真实 turn/start 记录，再核对原生技能输入。

**T6 — 测试资源投入与当前入口不匹配 [guided]**
Symptom: 45 项 credential-client 用例针对生产前端已不再引用的旧客户端适配器；旧单设备自动连接用例与当前 workspace 元数据所有者不匹配。大量浏览器场景再次展开已有低层覆盖。
Source: How Google Tests Software — 风险驱动的测试组合；Working Effectively with Legacy Code — 在实际变更入口建立保护。
Consequence: 套件变长且仍可能漏掉真正使用的入口。
Remedy: 删除旧客户端测试、重复的单设备凭据/启动组；保留所有服务端认证/凭据/设备接口测试以及多设备运行时测试。新增元数据所有者的旧设备迁移回归，并保留独立的实时思考完成计时回归。

### Fix Summary

| 范围 | 处理 | 保留的主要风险覆盖 |
|---|---|---|
| 旧凭据客户端 | 删除无生产调用者的测试文件 | 服务端认证、令牌绑定、私有文件、原子事务、安全失败 |
| 时长、协作、工具展示 | 精简输入和渲染矩阵 | 成功/失败与代理状态区分、正文安全、流式更新 |
| 目标、队列、单/多设备运行时 | 去除旧入口重复；保留竞争条件 | 只读权限更新、ack 顺序、不可自动重试、设备/线程隔离 |
| 文件读取及撤销 | 关键套件完整保留 | 限界读取、文件身份、下载内容、补丁冲突与回退 |
| 浏览器 | 78 项真实流程替代 246 项展开 | 设备同步、迁移、HTTP UUID、默认目录、目标、审批、输入、队列、文件及 Session ID |
| fixture | 清理无用导入、函数、枚举和编译加载 | TypeScript 无新增未使用测试声明 |

## 覆盖核对

比较精简前后的 Bun LCOV，以下 8 个关键生产模块原先覆盖的代码行无一丢失。这是行覆盖核对，不把它等同于完整分支或业务覆盖；Vue 行为另外通过真实桌面/手机浏览器验证。

| 模块 | 精简前覆盖行 | 精简后覆盖行 |
|---|---:|---:|
| server/bridge.ts | 183/214 | 183/214 |
| server/credentials.ts | 192/192 | 192/192 |
| src/composables/useCodex.ts | 1317/1385 | 1319/1385 |
| src/composables/useCodexWorkspace.ts | 198/198 | 198/198 |
| src/lib/profile-api.ts | 22/22 | 22/22 |
| src/lib/server-queue.ts | 130/130 | 130/130 |
| src/lib/workspace-files.ts | 121/121 | 121/121 |
| src/lib/worktree-changes.ts | 264/264 | 264/264 |

## 验证与运行边界
- `bun test tests/unit tests/integration --coverage`：634 pass，0 fail，5,420 assertions，48 文件。
- Vue 与服务端 TypeScript 检查通过；额外 noUnusedLocals 检查没有遗留未使用的测试导入/fixture。
- Vite/PWA 正式构建通过，保留原有 chunk-size 提示。构建输出放在 `.local/e2e-dist`，没有替换当前服务使用的 dist。
- 完整保留的 78 项 Playwright 在 desktop/mobile 上全部通过（3.9 分钟）；完整结果见 `/tmp/codex-merge-e2e-final.log` 为准。
- `git diff --check` 通过。没有测试 skip/only/fixme/todo 标记。
- 没有重启运行中的 Bun 服务，没有读取真实凭据，也没有推送远端。

### 可复验命令

~~~sh
bun run typecheck
bun run test
bun ./node_modules/vite/bin/vite.js build --outDir .local/e2e-dist --emptyOutDir
E2E_STATIC_DIR=.local/e2e-dist E2E_PORT=14831 MOCK_PORT=14511 bun run test:e2e
~~~

原始计数/覆盖：`/tmp/codex-merge-before.xml`、`/tmp/codex-merge-before-coverage/lcov.info`；最终常规测试/覆盖：`/tmp/codex-merge-final-tests.log`、`/tmp/codex-merge-final-coverage/lcov.info`。详细删除决策保存在本次会话的 `/tmp/codex-prune-stage*.json.applied.json` 和 `/tmp/codex-browser-removed.json`。
