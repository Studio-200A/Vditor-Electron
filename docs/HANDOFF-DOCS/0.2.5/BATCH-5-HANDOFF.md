# 批次 5 交接文档

> 写给新 Session 的 Agent，启动 0.2.5 批次 5（编辑器域迁移与批次 4 runtime 收口）。

## 项目概况

- **仓库**：`/home/shawnzhang/Projects/Vditor-Electron`
- **分支**：`dev-0.2.5`
- **版本**：0.2.0 已发布（`v0.2.0` tag = `bfaf25a`）；当前开发 0.2.5（渲染层架构重构）
- **环境**：Fedora Workstation Linux，`DISPLAY=:0`，Electron E2E 可正常运行（无容器/沙箱限制）
- **参考 worktree**：`../Vditor-Electron-0.2.0-reference`（detached @ `bfaf25a`，批次 11 前保持不动）

## 前置批次状态

- 批次 1-3 已完成：renderer TypeScript/esbuild 构建、基础 UI/纯函数迁移、AppStore 与文档状态模型均已落地。
- 批次 4 的代码、文件安全专项验证和用户手测已完成：`src/renderer/documents/` 提供 TabController、DocumentController、DocumentSaveController、DocumentCloseController、ExternalChangeController、session/recovery DTO。
- 批次 4 的重新出现文件“确认重建”修复已由专项 E2E 和用户手测验证；重新出现时使用 watcher 稳定正文作为 `expectedContent`，不是 `expectedAbsent`。
- 批次 4 记录暂为“待手测”，仅因修复后的完整 E2E 有一个与其无直接关联的 flaky 用例：`editor-modes.spec.ts` 的 `navigates outline headings in instant, WYSIWYG, and both split panes`。它在完整 E2E 中超时，精确重跑中还出现过 `#appTooltip` 未显示；不可把单项重跑替代为无失败全量证据。
- 批次 5 开始前，先阅读 Tracker 的批次 4 记录和本文件。若用户没有接受该 flaky 风险或尚未取得新的干净全量运行，先记录该状态，不要重写或回退批次 4 已验证的文档安全迁移。

## 批次 5 施工卡

摘自 `docs/15-0.2.5-EXECUTION-TRACKER.md` §6：

> **目标**：迁移与 Vditor 耦合最深的编辑器域，并收口批次 4 已建立命令边界中仍依赖 editor runtime 的 legacy 执行与 UI 协调。用户可观察行为和文件安全契约必须保持不变。

**有序子步骤：**

1. **EditorController**：迁移 Vditor 创建、销毁、重建、runtime 持有、内容读写、focus、模式切换及 input/blur/after 回调；每个 runtime 绑定稳定 document ID，并在异步回调提交前确认 runtime 仍有效。
2. **批次 4 runtime 收口**：将当前正文读取、自动保存 timer、保存交易调用、关闭时 runtime 释放、恢复正文注入、外部变化的 editor UI 协调迁入 EditorController 或其窄协作接口。
3. **editor-options**：从设置构造 Vditor options；仅确实需要重建 editor 的设置允许进入该边界，展示类设置不得清空 undo 或无关重建。
4. **SplitViewController**：迁移 SV 行号、空白符 canvas、分栏比例/拖动、滚动增强与特殊缩进选择。所有资源 tab-scoped，离开 SV、关闭标签、重建 editor 时必须 dispose。
5. **ToolbarController**：迁移当前支持的显示/隐藏状态、toolbar 挂载和按钮过滤。浮动工具栏尚未实现，不得在本批次新增。
6. **OutlineController 与 ImageController**：迁移 Desktop 大纲生成/跳转、图片上传压缩和资源基址；所有 Vditor 私有 DOM 查询必须继续留在 adapter。
7. **FindController**：迁移查找替换 widget、query/matches/active-index、refresh timer、窗口级快捷键和 tab/editor 切换清理。通过 EditorController 的窄接口编辑内容，不能以整篇 `getValue()`/`setValue()` 绕过 selection、undo 或 mode 状态；收敛 F3/Escape 的重叠监听。
8. **标签切换 runtime 协调**：迁移 `switchTab()` 中 editor host 激活、toolbar 挂载、大纲/查找刷新和 focus。TabController 继续只发送 activate 意图，DocumentController 继续拥有文件安全命令。
9. **测试收口**：替换本域源码字符串测试，覆盖重复调用、过期刷新、集合错位、dispose、editor 重建和迟到回调。

## 当前 legacy 入口与目标归属

`src/renderer/app.js` 仍包含下列批次 5 迁移源；迁移时按当前源码核对，不能仅依赖此清单：

- `ensureEditor()`、`rebuildEditor()`、`editorOptions()`、`synchronizeVditorMode()` 和 mode shortcut 处理。
- `onEditorInput()`、`currentContent()`、per-tab `saveTimer`，以及由 input 触发的恢复/自动保存调度。
- `switchTab()` 中 Vditor host、toolbar、focus、bottom spacer、outline/find 刷新协调。
- `disposeClosedTabRuntime()` 的 Vditor/observer/timer/listener 释放。
- `restoreRecoverySnapshots()` 的 editor 正文交接与 recovery banner 协调。
- `renderOutline()`、heading/anchor navigation、图片资源观察、SV 行号、空白符、底部 spacer、table composition scroll 和 editor context menu。
- `openFind()`、`refreshFind()`、`replaceFindMatch()`、`replaceAllFindMatches()` 及窗口级 find 快捷键。

迁移完成后，这些职责不应以“新 controller 调旧 app.js callback”的形式长期保留。旧实现接入新 controller 并通过测试后，应在同一职责迁移中删除；但不要在一个提交中同时搬迁多个高风险 editor 子域。

## 不可突破的边界

- **Vditor 固定 3.11.3**：不升级 Vditor，不修改 `node_modules/vditor` 或 copied vendored 资源。
- **adapter 是唯一私有 DOM 边界**：任何 `.vditor-*` 私有选择器、结构判断、Range workaround 和 mode-specific DOM 逻辑只能放在 `src/renderer/vditor-adapter.js`。新增或迁移假设要有 focused adapter test，并更新 `docs/20-VDITOR-UPGRADE.md` 的检查项。
- **DocumentController 仍是文档安全 owner**：EditorController 不得直接调用 AppStore 的文档写入 API，不得直接改保存基线、冲突、不可用或 recovery 状态。它仅通过命名回调/DocumentController 命令报告 input、当前正文、保存请求、关闭完成、恢复注入完成和外部变化结果。
- **文件安全保持不变**：canonical identity、watcher `ready → reconciliation → live`、generation/read revision、单次读取基线、恢复状态和 TOCTOU 边界遵循 `docs/05-FILE-SAFETY.md`。editor runtime 迁移不能新建第二条 watcher 或保存生命周期。
- **撤销与选区**：不得因标签切换、模式切换、查找替换、toolbar 展示设置或纯展示操作丢失 undo、selection、scroll 或 mode state。复用 Vditor 的 input、serialization、selection 和 undo 路径。
- **生命周期**：每个 listener、bridge unsubscribe、timer、rAF、MutationObserver、ResizeObserver、Range 和 Vditor instance 都要有 owner、有效性检查和 cleanup。`dispose()` 必须幂等。
- **安全配置不变**：保持 `contextIsolation: true`、`nodeIntegration: false`，不扩大 preload API，不在 renderer import Node 内置模块。
- **用户行为不变**：不改 UI 文案、快捷键、设置默认值、Markdown 语义或工具栏产品范围；浮动工具栏、React/Vue、Monaco/CodeMirror、云服务均不在范围内。

## 必须证明

- 三种编辑模式下的创建、切换、重建、toolbar、scroll、outline、图片和快捷键保持 0.2.0 行为。
- Vditor 实例数量与 0.2.0 一致；旧 runtime 在重建或关闭后完整释放，任何迟到 callback 不修改当前 document 或 DOM。
- 自动保存、Save As、关闭、外部变化和 recovery 在 runtime 协调迁移后仍经过 DocumentController 的安全命令，并保持 identity/binding/expected-content 契约。
- 查找替换不破坏 selection、undo 或 mode；F3/Escape 和 find refresh timer 不会跨标签、关闭或重建泄漏。
- Vditor 私有 DOM 假设均集中在 adapter，有 focused adapter test；相应用户可见行为加入 Vditor 升级检查文档。
- 本域 `renderer-shell.test.ts` 的源码字符串断言被行为测试替代；不通过“源码中存在函数名”证明行为。

## 建议定向阅读

1. `AGENTS.md`。
2. `docs/15-0.2.5-EXECUTION-TRACKER.md`：第 1-5、8-10 节和批次 5 施工卡；同时阅读批次 4 的执行记录。
3. `docs/14-0.2.5-RENDERER-REFACTOR-PLAN.md`：第 4.5、4.6、19、22-25 节。
4. `docs/05-FILE-SAFETY.md`：完整阅读，特别是保存、外部变化、watcher 生命周期和过期结果。
5. `docs/20-VDITOR-UPGRADE.md`：完整阅读；它列出 Vditor 3.11.3 的现有私有 DOM 约束和升级验证。
6. `docs/01-CODE-STRUCTURE.md`：仅阅读 renderer、Vditor 集成、测试相关章节，再以当前源码为准。
7. `src/renderer/app.js` 中上述 editor 源函数、`src/renderer/vditor-adapter.js`、`src/renderer/documents/`、相关 unit/E2E tests，以及 `v0.2.0` reference worktree 中的同一行为。

## 当前测试风险

- `tests/e2e/editor-modes.spec.ts:1154` 现有“大纲导航”用例同时覆盖 tooltip、链接、outline、三种模式、SV 双栏与 Vditor TOC，且有多处固定 `waitForTimeout(300)`；它是已知 flaky 风险。
- 批次 5 应在迁移 FindController/OutlineController 时拆分该用例：tooltip/link、Desktop outline、SV 双栏导航和 Vditor TOC 分别独立验证，并用可观察稳定状态替换固定延迟。不要把这个测试错误归为批次 4 文件生命周期回归。
- 首次完整 E2E 失败时保留完整输出、trace 和 error context；先判断是应用断言失败还是 flaky，不能通过单项重跑改写全量结果。

## 本 Session 工作原则

以下规则由用户明确要求，**必须遵守**：

### 1. 专项测试按需运行

可以运行需要沙箱外权限的专项测试（E2E、构建验证等）。使用以下命令按需选择：

```bash
npm run build                    # 编译 main + renderer 并复制静态资源
npm test                         # 单元测试（vitest）
npm run check:vditor             # Vditor 版本锁定检查
npm run format:check             # Prettier 格式检查
npm run lint                     # ESLint
npm run typecheck                # main/preload TypeScript
npm run typecheck:renderer       # renderer TypeScript
node scripts/run-electron-e2e.js tests/e2e/<file>.spec.ts -g "<test name>"  # 单条 E2E
```

### 2. 全量测试留给用户手动

**不要运行** `npm run check:all` 或 `npm run check`。全量 E2E 由用户在手动测试阶段运行。

### 3. 代码修改后同步开发文档

每次有实质性代码/结构变化后，同步更新以下文档：

- **`CHANGELOG.md`**：用户可见的行为变化；0.2.5 主要是内部架构变化，但仍需记录重要结构变化和修复。
- **`docs/15-0.2.5-EXECUTION-TRACKER.md`**：批次执行记录（§10），包括实施进度、验证结果、遗留问题。
- **`docs/01-CODE-STRUCTURE.md`**：代码架构全景；新增文件、目录、模块或职责边界时必须更新。
- **`docs/20-VDITOR-UPGRADE.md`**：新增或变更 Vditor 私有 DOM 假设、adapter contract 或用户可见 Vditor workaround 时必须更新。
- **其它受影响的文档**：文件安全、跨平台、主题等契约变化，分别同步 `docs/05-FILE-SAFETY.md`、`docs/03-CROSS-PLATFORM.md`、`docs/04-THEMES.md`。

### 4. 不做 git commit

**不要执行 git add / git commit**。所有改动留在工作区，用户手动运行全量测试通过后自行 commit。

## 批次结束要求

完成后在 Tracker 的批次 5 记录中说明：

- 哪些 legacy editor 职责已迁出、哪些仅因后续批次依赖而保留。
- EditorController、DocumentController、TabController、FindController 和 adapter 的实际协作边界。
- 每种 runtime 资源的 owner 与 cleanup 位置。
- 每个 Vditor 私有 DOM 假设的 adapter 测试和升级文档位置。
- 失败/竞态/泄漏场景的测试证据，尤其是重建、关闭、切换标签和过期 callback。
- 每条专项验证的真实结果、用户全量验证结果及任何 E2E flaky 记录。

批次 5 完成后不要自动进入批次 6；等待用户启动 zustand 决策批次。
