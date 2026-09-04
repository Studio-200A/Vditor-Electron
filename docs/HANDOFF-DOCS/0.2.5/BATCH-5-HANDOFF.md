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
- 批次 4 的代码、文件安全专项验证和用户手测已完成：`src/renderer/documents/` 提供 TabController、DocumentController、DocumentSaveController、DocumentCloseController、ExternalChangeController、session/recovery DTO；用户提供的最后一次完整控制台记录为 47 个 Vitest 文件、431/431 测试与 142/142 Electron E2E 通过（此前 406/406 是较早文档快照）。
- 批次 4 的重新出现文件“确认重建”修复已由专项 E2E 和用户手测验证；重新出现时使用 watcher 稳定正文作为 `expectedContent`，不是 `expectedAbsent`。
- 历史完整 E2E 曾有与批次 4 无直接关联的 outline flaky；该首次失败与精确重跑记录保留。2026-09-03 的后续完整 E2E 已 142/142 通过，不得抹除历史记录或回退批次 4 已验证的文档安全迁移。

## 批次 5 当前进度与施工顺序

目标仍是迁移与 Vditor 耦合最深的编辑器域，并收口批次 4 命令边界中依赖 editor runtime 的 legacy 协调；用户可观察行为和文件安全契约必须保持不变。当前顺序已按实际实施进度重排，接班 agent 不应回到旧清单顺序：

### 已完成或已接入

1. **EditorController 基础生命周期**：已接管 Vditor 创建、销毁、重建、runtime generation、模式同步、滚动恢复、currentContent、focus 和正文注入。`after/input/blur` 回调使用 generation 拒绝旧实例迟到结果。
2. **OutlineController**：已接管 Desktop outline DOM、snapshot、折叠状态和防抖 refresh；仍需补齐最终 tab 激活/销毁协作测试。
3. **FindController**：已接管 find widget、query/matches/index、refresh timer、F3/Enter/Escape、tab/runtime 切换清理；`replaceTextMatch()` 经 adapter 复用 Vditor 原生 selection/input/undo 路径。
4. **SplitViewController**：已完成施工卡提取，包含 SV 行号、空白符 canvas、20–80% 比例、divider 拖动、source-only/preview-only/both 布局、滚动增强、列表缩进 Range 和自动缩进。每 tab 的 observer、rAF、scroll/pointer/keydown runtime 均在 rebuild/关闭时清理；Vditor 私有 selector、Range 和结构判断仅在 adapter。
5. **EditorController runtime 子阶段**：自动保存 debounce timer 已迁入 controller 私有 per-tab Map；恢复、冲突/重新出现重载、watcher 自动重载统一使用 `injectContent()`；保存正文选择使用 `contentForPersistence()`；`onEditorInput()` 的正文、modified、content revision 和 pending recovery 标记使用 `applyInput()`。
6. **构造、工具栏与图片子域**：`editor-options.ts` 已迁出 constructor-only settings、离线 CDN、locale、relative resource base、upload callback 和 Vditor callbacks；`ImageController` 已接管图片压缩、文件写入及相对 Markdown 插入；`ToolbarController` 已接管 shared mount 的归还/交接、preview controls 禁用、pending 状态和 wrap-height 双 rAF 清理。它们均不访问 Vditor 私有 DOM，现有 adapter 边界未扩大。
7. **图片 runtime 与 Outline 切换协作**：`ImageRuntimeController` 已接管每 tab 的 adapter-backed relative image observer、resource base、destroy/rebuild detach 和 allow-SVG policy reload；`OutlineController.onRuntimeChanged()` 会取消旧 tab 的待刷新并立即按新 active tab 渲染。相对资源与 SVG 私有 DOM 仍只经 adapter。
8. **标签切换 runtime 编排**：`EditorRuntimeCoordinator` 已接管 `switchTab()` 的 editor/UI 顺序：旧 toolbar 归还、active host、ensure、toolbar hand-off、split/outline/find refresh 和 session 持久化；bottom spacer 与 pending anchor rAF 在回调时核对 active document ID，快速切换后不会作用到旧 tab。DocumentController 仍是文件安全命令 owner。
9. **Recovery runtime 调度**：`RecoveryRuntimeController` 已接管每 tab recovery snapshot 的 debounce timer 和 recovery-store 串行队列。它只调度 save/discard，且以 snapshot ID/revision 拒绝旧操作；snapshot DTO、recovery 状态、不可用文件语义与 DocumentController 边界保持不变。
10. **外部变化 editor 协作**：DocumentController/app shell 仍分类 watcher 和 safe-write 结果，但调用 `EditorController.beginExternalChange()` 取消 conflict/reappearance 的 auto-save，并只在已批准 reload 时调用 `applyExternalContent()` 注入 Vditor。它不接管冲突、binding 或保存基线状态。
11. **Recovery 正文 runtime 协作**：shell 仍合并 snapshot、维护 recovery state/banner；`EditorController.applyRecoveryContent()` 对已存在 runtime 注入正文，否则标记 pending，`applyPendingContent()` 在 Vditor `after` 阶段消费该标记。shell 不再直接调用 Vditor 注入 recovery 内容。
12. **初始化正文 reconciliation**：`EditorController.reconcileInitializedContent()` 在 Vditor `after` 时保留 dirty/pending recovery 的 saved baseline，再同步 editor 正文与 modified 状态；shell 只保留应用级 after 资源、DOM 和 UI 协调。
13. **Rebuild 正文捕获**：`EditorController.rebuild()` 在销毁 Vditor 前经 adapter-backed reader 捕获正文；shell 的 `rebuildEditor()` 只转发重建请求，图片 source 还原继续由 adapter 保证。
14. **底部 spacer runtime**：`EditorController` 已接管每 tab bottom spacer 的 ResizeObserver、无 observer fallback 及 destroy/rebuild cleanup；Vditor CSS 变量仍只由 adapter 写入。
15. **Mode transition runtime**：`EditorController.prepareModeTransition()` 已接管 Vditor mode 切换后的 rAF、延迟 mode 同步和 scroll restore；destroy/rebuild 会取消仍未执行的 callback。
16. **Mode shortcut listener**：`EditorController.attachModeShortcut()` 已接管 tab host capture keydown listener；listener 跨 rebuild 保留，在 tab close 的 destroy 时释放，不再存入 tab runtime。
17. **Outline observer**：`EditorController.observeOutlineChanges()` 已接管每 tab Vditor DOM observer；新 runtime 注册前替换旧 observer，destroy/rebuild 均释放，不再存入 tab runtime。
18. **表格与滚动条 runtime cleanup**：`EditorController` 已接管 table composition-scroll cleanup 和 Vditor 编辑面自动隐藏滚动条增强；每次 rebuild 替换，destroy/rebuild 释放 listener/timer，不再存入 tab runtime。
19. **Document anchor listener**：`EditorController.attachDocumentAnchorNavigation()` 已接管 tab host 的 anchor navigation capture listener；跨 rebuild 保留，在 tab close 时释放，链接业务判断仍由 shell callback 提供。
20. **Editor context-menu listener**：`EditorController.attachContextMenu()` 已接管 tab host 的 context-menu capture listener；跨 rebuild 保留，在 tab close 时释放，菜单、selection capture/restore 和 table action 业务仍由 shell 与 adapter 协作。
21. **Recovery banner UI**：`RecoveryBannerController` 已接管 banner 渲染和 Save/Save As/Discard listener lifecycle；shell 通过明确 callback 保留保存、关闭、snapshot 合并和 file-safety 决策。
22. **Toolbar runtime handlers**：`EditorController.attachToolbarHandlers()` 已接管 Vditor toolbar 的 click/mousedown listener lifecycle；每个新 toolbar 替换旧 listener，rebuild 和 tab close 前释放，菜单语义仍由 shell callback 提供。
23. **Delayed editor focus**：`EditorController.scheduleFocus()` 已接管 Vditor `after` 的延迟 focus；仅活动 tab 可执行，rebuild 和 tab close 取消旧 timer。
24. **手测回归修复（2026-09-04）**：SV source 的 adapter capture listener 已直接处理 Vditor 原有 `Ctrl/Cmd+Shift+I`（减少缩进）与 `O`（增加缩进）语义，不再依赖其在 SV 中禁用的 toolbar path。活动 editor host 对原生 `Ctrl/Cmd+V` 保存 Range、经现有 `app:readClipboard` 读取 `{ text, html }`、恢复选区后重新触发 Vditor 自己的 paste handler；右键 Paste 仍使用同一 adapter 命令路径。不得在 renderer 自行解析富文本或改写 undo/序列化。

### 已关闭的手测判断与待复测项

- 跨 WYSIWYG、IR 与 SV 的复杂长文档滚动位置无法像素级对齐，是 0.2.0 已确认的 Vditor 上游布局限制；用户明确决定不增加 Desktop 兜底。保留现有的语义位置/状态同步契约。
- 本轮专项通过：`vditor-adapter.test.ts` 31/31、`npm run typecheck:renderer`、`npm run build`，以及沙箱外 Electron 精确用例 4/4（SV 两条缩进快捷键、右键 rich paste、原生 rich paste、原生 Markdown 纯文本 paste）。不替代用户真实剪贴板手测或全量检查。
- 下一项不应直接实现：删除 Markdown 图片后的 `assets/` 孤儿资源清理需要用户先决定引用范围、预览确认和可恢复删除策略；自动保存或退出时静默删除不安全。

### 接下来必须按此顺序

22. **完成 EditorController 与批次 4 runtime 协作边界**：继续迁移剩余命名 runtime 回调；DocumentController 继续独占 identity、binding、expected-content、保存/关闭/恢复安全语义。补充旧 callback、关闭后异步完成和 rebuild 后 callback 的失效测试。
23. **测试与文档收口**：本域 renderer-shell 已无 app.js 源码字符串断言；继续拆分大纲组合 E2E、补齐 dispose/stale/rebuild 行为测试，并同步 Tracker、架构图、升级文档和 CHANGELOG。全量 `check`/`check:all` 留给用户。

## 当前 legacy 入口与目标归属

`src/renderer/app.js` 仍包含下列批次 5 迁移源；已迁移的职责不要重新实现，接班时按当前源码核对：

- `synchronizeVditorMode()` 和部分 mode shortcut/toolbar runtime 协调；`editorOptions()` 已是保留 callback 协调的薄调用层，构造选项已在 `editor-options.ts`。
- `onEditorInput()` 的行号/大纲/UI 刷新；正文状态、自动保存 timer、input 基础状态和 recovery snapshot 调度已由 editor-domain controller API 承担。
- `performSaveTab()` 的安全交易编排、`restoreRecoverySnapshots()` 的 recovery banner/状态协调、`preserveUnavailableTab()` 的不可用状态转换；这些必须继续通过 DocumentController 的命令和安全语义。`RecoveryRuntimeController` 只接收已确定的 save/discard 意图。
- `switchTab()` 已是 `EditorRuntimeCoordinator.activate()` 的薄调用层；host active、toolbar、ensure、bottom spacer、anchor、outline/find 和 session 顺序已迁出。
- `disposeClosedTabRuntime()` 的文档 recovery 操作与剩余 editor-owned observer/listener 释放。
- `renderOutline()`、heading/anchor navigation、底部 spacer 和 table composition scroll。编辑器右键菜单的 listener lifecycle 已在 `EditorController`，菜单业务仍在 shell。图片压缩、写入、Markdown 插入、资源观察和 SVG policy reload 已在 `ImageController`/`ImageRuntimeController`。

已从 app.js 删除或只保留窄回调的职责：SV 行号/空白符/divider/滚动/缩进、Find widget 与窗口快捷键、Outline DOM/snapshot、Vditor 正文 `setValue()` 直写、tab saveTimer 直接管理。

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

- 历史 outline、Split 行号和列表缩进的 flaky/隔离重跑记录保留；它们不是 2026-09-03 后续完整 E2E 142/142 通过的替代证据。
- 本轮首次完整 E2E 的第二实例启动超时、随后 3 个稳定 E2E 失败均已记录在 Tracker：启动问题来自 locale 初始化顺序，其余分别为 range 测试交互、rebuild destroy 错误传播和 SV 空白符 redraw 补偿；修复后精确回归与完整 E2E 均通过。

## 当前专项验证证据

- `tests/unit/renderer/editor-controller.test.ts` 当前 8 条，覆盖 runtime generation、destroy 幂等、destroy 失败清理与传播、mode 同步、自动保存 timer、初始化阶段正文注入、pending persistence 和 input 状态。
- `tests/unit/renderer/recovery-runtime-controller.test.ts` 覆盖 debounce 替换、discard 失效、unavailable 保存串行和 recovery-store 非致命失败；与 editor/document/store 关联单测共 50/50 通过。
- Split/adapter 聚焦测试合计 35/35；renderer typecheck、build 通过。
- 当前 HEAD 的自动保存 Electron 精确用例通过（1/1）；恢复快照正文注入精确用例通过（1/1）。
- 本轮新增的 editor-options、image-controller、toolbar-controller 和 editor-controller 聚焦单测共 18/18 通过；`typecheck:renderer` 和 `build` 通过。未运行 E2E、`check` 或 `check:all`。
- 图片 runtime、Outline 和 adapter 聚焦单测 38/38 通过；精确 Electron SVG policy 用例 1/1 通过。未运行全量 E2E、`check` 或 `check:all`。
- `editor-runtime-coordinator` 与 editor/toolbar/outline/find 聚焦单测 17/17 通过；工具栏 tab hand-off 精确 Electron 用例首次因漏导出 coordinator 超时，修复 export 后重跑 1/1 通过。该重跑不代替全量 E2E。
- 用户提供的最后一次 `npm run check:all` 控制台记录为 47 个 Vitest 文件、431/431 测试和 Electron E2E 142/142 均通过；45/406 是较早文档快照。当前阶段应由用户先提交；接班 agent 不得在该提交前继续批次 5 的 recovery/external-change/autosave 协调迁移。

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
