# 批次 9 交接文档

> 写给新 Session 的 Agent，启动 0.2.5 批次 9（移除 legacy app.js 与测试收口）。本文件只在 Session 开始时阅读一次；施工进度、问题、测试证据和状态变更只写入 `docs/15-0.2.5-EXECUTION-TRACKER.md`，不要在本文件追加过程记录。

## 1. 项目概况

- **仓库**：`/home/shawnzhang/Projects/Vditor-Electron`
- **分支**：`dev-0.2.5`
- **起始提交**：`60ab08f7415a2ec8c682a43a2fd4c3cce2ae3572`（`refactor(editor): isolate document link navigation`）
- **版本基线**：`v0.2.0`（行为基线 tag）是行为基线；当前进行 `0.2.5` 开发。`package.json` 当前版本仍为 `0.2.0`，版本升级属于批次 10，不要在批次 9 提前修改。
- **环境**：Linux。Electron/Chromium E2E 可以在沙箱外启动；本次精确专项用例可运行。不要把 Linux 证据外推为 Windows/macOS 验证。
- **参考 worktree**：`/home/shawnzhang/Projects/Vditor-Electron-0.2.0-reference`（detached，当前 `bfaf25a7bfbb76fa8bbeb19614889f4f77f26cd3`；最终审查前保持不动）。

交接快照建立时工作树干净；写入本文件后工作树只会新增这份未提交交接文档。保留此前已存在的提交，不回退或改写历史。

## 2. 前置批次状态

- 批次 0 已完成基线冻结和核心行为清单；基线人工对比仍是批次 9 收口门禁的一部分。
- 批次 1 已完成 renderer TypeScript 构建管线与组合入口。
- 批次 2 已完成纯函数、主题和基础 UI 域迁移。
- 批次 3 已完成 `AppStore`、文档状态模型和快照投影边界。
- 批次 4 已完成文档/标签生命周期、identity、保存队列和关闭语义迁移。
- 批次 5 已完成 EditorController、ToolbarController、SplitViewController、FindController、RecoveryRuntimeController 等编辑器域迁移。
- 批次 6 已完成 zustand 必要性评估，结论是继续使用自研 `AppStore`，不要引入 zustand。
- 批次 7 已完成阶段独立复核；发现的问题已在后续修复提交中处理，独立审查证据仍以 Tracker 为准。
- 批次 8 已完成工作区、设置、窗口、菜单和导出域的主要 controller 迁移。
- 批次 8.1 已完成 Vditor adapter 类型契约校正（Tracker 记录提交 `3549468`）。
- **Tracker 最近一次全量记录**：2026-09-04 用户运行 `npm run check:all` 时，非 E2E `check` 完成；E2E 首轮为 150/151，其中一个用例失败，同一 HEAD 精确重跑两次均为 1/1。该记录保留在 Tracker，不能当作当前 HEAD 的一次干净全量证据。
- **当前遗留**：批次 9 的 Tracker 旧记录仍写着“待手测；实现与专项自动化检查完成”，但在后续提交中继续发现并迁出了菜单旧实现和文档链接导航；当前实际状态应为“实施中”，不能标记已完成。

## 3. 本批次范围与施工顺序

批次 9 的目标是完成 legacy `app.js` 删除后的职责收口和行为测试收口，不是仅把入口文件改名。接班 Agent 按以下顺序继续：

1. 以当前 `src/renderer/app/app-composition.js` 为事实来源，逐个确认仍留在组合层的业务职责，并按职责迁移到现有 controller 或新建单一职责 controller。优先处理保存安全交易、文档/标签命令、设置与 session/recovery 组合、工作区/探索器命令和剩余全局事件装配；每个迁移必须保留 `fileIdentity`、保存基线、watcher ready/reconciliation 和迟到结果保护。
2. 为每个迁移单元建立明确的输入、状态提交、DOM/bridge 协作和 cleanup 边界；不要只创建转发 wrapper 来降低行数。现有跨域组合回调可以留在组合入口，但业务状态写入和资源 owner 必须属于对应域。
3. 继续清理全仓旧入口、重复实现和源码字符串断言。确认 `index.html` 只加载 `app/app-composition.js`，构建脚本不会留下 `dist/renderer/app.js`，并完成 `app.js` 职责到目标模块的映射。
4. 每个单元运行最小单测、类型/格式检查和受影响的 Electron E2E；构建后再运行需要真实 Electron/Vditor 的专项。不要运行全量 `npm run check`、`npm run check:all` 或全量 E2E，留给用户手动执行。
5. 所有代码迁移和专项验证完成后，把真实结果、未运行的全量门禁和批次 0 人工对比要求写入 Tracker；等待用户执行全量测试与手测，不能自动进入批次 10。

**不包含范围：** 不新增用户功能；不为删除入口而重写已迁移模块的内部结构；不引入 React/Vue/Monaco/CodeMirror 或 zustand；不升级 Vditor；不提前做批次 10 的版本号、发布包、性能、Linux 候选包或最终文档整理；不把全量检查交给接班 Agent 代跑，除非用户明确改变约定。

## 4. 现有归属与迁移目标

当前旧 `src/renderer/app.js` 已删除；剩余组合代码位于 `src/renderer/app/app-composition.js`。以下是接班 Agent 应继续核对的职责映射：

- `performSaveTab`、`saveTab`、`confirmExternalOverwrite`、`reloadExternalChange`、`reloadReappearedFile`、`confirmExternalFileRecreate` → 目标为文档保存/外部状态 workflow controller，继续由 `DocumentController` 提供文档与 identity 保存队列；不能把安全写入绕过 `DocumentController`。
- `createTab`、`newTab`、`openPath`、`openPaths`、`switchTab`、`closeTab`、`confirmTabClose` → 目标为 `DocumentController`（文档命令与安全边界）和 `TabController`（标签表现）的窄接口组合；保留 `EditorController` 先释放 runtime、再删除文档的顺序。
- `watchTabDocument`、`releaseDocumentWatch`、`suspendDocumentWatches`、`rebindDocumentWatches`、`rebaseOpenTabs` → 已有 `DocumentController`、`ExternalFileChangeController` 和 workspace/binding transition 语义 owner；若继续拆分，只能收口重复协调，不得建立第二套 watcher owner。
- `setWorkspace`、`refreshTree`、`renameExplorerItem`、`deleteExplorerItem` → 目标为 `WorkspaceController`/`ExplorerController` 与 `DocumentController.transitionBindings()`；目录重命名和 Save As 交接必须保持 canonical identity，不得以 display path 替代。
- `applyTheme`、`applyPresentationSettings`、`applyLiveVditorSettings`、`saveSettings`、`resetCurrentSettingsPage` → 目标为现有 settings/theme/presentation controller 的窄协作；presentation-only 设置不得重建全部 Vditor 实例。
- `persistSession`、`restoreWorkspaceSession`、`restoreDocumentSession`、`finishAppRestoration` → 目标为 session DTO 与 `AppController` 启动阶段的组合回调；不可序列化 AppStore、Vditor、DOM、observer、timer 或其他 runtime handle。
- `setupEvents` 及其中的 DOM 事件注册 → 目标为应用壳层或各自 UI controller；`AppController` 已拥有窗口级快捷键、Markdown drag/drop、open-files/menu IPC 订阅，剩余事件不能继续无 owner 地堆在组合入口。
- `editorOptions`、`setupSplitEditorEnhancements`、`ensureSplitResizer`、`updateSplitLineNumbers`、`mountEditorToolbar`、`rebuildEditor` → 继续核对 `EditorController`、`SplitViewController`、`ToolbarController` 的责任边界；Vditor 私有 DOM 访问只能通过 `src/renderer/vditor-adapter.js`。
- `renderOutline`、`scrollToHeading` → `OutlineController` 与 adapter 语义 API；不要在新模块复制私有 selector。
- `showAppTooltip`、`setupSidebarTooltips` → 可继续迁移为独立的应用 tooltip UI controller，并为 mouseover/mousemove/mouseout 注册和清理建立测试；截至本快照尚未创建该 controller。

**已迁移、不要重复实现的职责：**

- `AppController`：启动阶段顺序、窗口快捷键、拖放、open-files/menu IPC 和 cleanup。
- `ExportHtmlBuilder`/`ExportController`：Vditor snapshot、local-file URL 可移植化、HTML/PDF 导出事务。
- `SettingsPersistence`：偏好与 persistent state 的分离写入、串行化、失败语义。
- `SettingsDialogLayoutController`：设置窗口尺寸、拖动、resize listener 和 cleanup。
- `RecoveryRestoreController`/`RecoveryRuntimeController`：recovery snapshot 恢复状态、队列和 runtime 生命周期。
- `ExternalFileChangeController`：watcher 事件分类和外部修改、删除、重新出现路由。
- `SidebarLayoutController`：侧栏动画、FLIP、fallback timer 和 cleanup。
- `MenuController`：应用菜单 popup、子菜单、checked state 和 listener cleanup；旧的 `setupLegacyAppMenus` 已在 `3f0499b` 删除，不得恢复第二套菜单。
- `DocumentLinkNavigationController`：文档链接分类、Ctrl/Cmd 导航、相对 Markdown 解析、危险 scheme 拦截、链接 hint 和 tooltip 协作。
- `DocumentController`：打开去重、文档保存队列、identity 保存队列、关闭协调和 binding transition；不要在组合层增加另一套队列。

## 5. 不可突破的边界

- Vditor 固定为 `3.11.3`；所有私有 DOM、Range 和结构假设只能位于 `src/renderer/vditor-adapter.js`。
- 保持 `contextIsolation: true`、`nodeIntegration: false`；renderer 不导入 Node 内置模块，preload 只提供窄能力。
- 新增 listener、watcher、timer、rAF、observer 或订阅必须有明确 owner 和 close/switch/rebuild/shutdown cleanup。
- Linux 通过不代表 Windows/macOS 验证；平台限制继续记录在 `docs/03-CROSS-PLATFORM.md`。
- 保存迁移必须保留一次磁盘事实到正文、`expectedContent`/`expectedBytes` 和安全写入器的现有映射；不得用第二次无关读取洗掉基线后的外部修改。
- 不得以当前专项测试、历史全量数字或精确重跑替代当前 HEAD 的 `check:all` 与批次 0 人工基准对比；在用户完成两项前批次状态保持“实施中”或“待手测”。
- 不得修改稳定应用身份 `com.github.studio-200a.vditor-electron`，也不得将批次 10 的发布/版本工作混入本批次。

## 6. 必须证明 / 验收标准

- **行为保持：** 新建、打开、保存、另存、自动保存、关闭确认、三种编辑模式、工具栏显示/隐藏、标签切换、session/recovery、外部修改/删除/不可读和工作区删除路径与 0.2.0 基线一致。
- **状态安全：** `fileIdentity` 是去重、冲突、不可用状态、Save As 和 watcher 所有权依据；异步保存、恢复、重绑、关闭和重建后的迟到结果不能修改替代文档。
- **资源释放：** 设置窗口、标签切换、工作区切换、editor rebuild、find widget、窗口快捷键、drag/drop、watcher 和 tooltip 的 listener/timer/observer 都有明确 owner、幂等 dispose 和回归测试。
- **私有 DOM 假设：** 新 controller 只调用 adapter 语义接口；任何 selector、Range workaround 或 Vditor 结构假设都留在 `vditor-adapter.js`，并有 focused adapter 测试及必要的 `docs/06-VDITOR-UPGRADE.md` 记录。
- **依赖方向：** 不出现可被任意模块修改的全局 state、循环依赖、宽泛 IPC/bridge 契约或新旧实现并行；EditorController、WorkspaceController/ExplorerController 的文档与路径写入通过命名命令/transition 协作。
- **测试证据：** `renderer-shell.test.ts` 不再依赖旧入口源码字符串；shell 只验证 DOM、脚本顺序和静态资源契约；核心行为由 unit/integration/E2E 覆盖。
- **批次门禁：** 全仓搜索、干净当前 HEAD 的 `npm run check:all`、批次 0 人工基准对比和 Tracker 执行记录全部完成后，才可把批次 9 标记为“已完成”。

## 7. 首轮阅读顺序

1. `AGENTS.md`。
2. 本文件，然后不再重复读取。
3. `docs/15-0.2.5-EXECUTION-TRACKER.md`：第 5 节状态表、第 6 节批次 9 施工卡、第 10 节批次 8/8.1/9 执行记录；先修正当前状态与本次新增提交的记录，再开始新的迁移。
4. `docs/14-0.2.5-RENDERER-REFACTOR-PLAN.md`：第 4 节共同原则、第 18 节文档域、第 19 节编辑器域、第 21 节 legacy 删除、第 22 节测试调整、第 25 节回归与泄漏检查。
5. `docs/01-CODE-STRUCTURE.md`：只读取第 6、7、10、14、15 节中与 renderer、Vditor、UI controller、依赖和测试相关的部分；它是导航图，实际代码优先。
6. `docs/05-FILE-SAFETY.md`、`docs/03-CROSS-PLATFORM.md`；涉及 adapter 时读取 `docs/06-VDITOR-UPGRADE.md`。
7. 实际读取 `src/renderer/app/app-composition.js`、已列出的 controller、`src/renderer/pure-functions.ts`、相关 unit/E2E 测试和 `v0.2.0` reference worktree；不要通读整个 `src` 或完整 Git 历史。

## 8. 当前测试风险与验证证据

### 本次已实际运行的专项验证

- `npm test -- --run tests/unit/renderer/window-and-menu-controller.test.ts`：3/3 通过。
- `npm run typecheck:renderer`：通过。
- `npm run build`：通过；main、renderer 和离线 Vditor/renderer assets 构建成功，`pure-functions` bundle 包含新控制器。
- `npm test -- --run tests/unit/renderer/document-link-navigation-controller.test.ts tests/unit/vditor-adapter.test.ts`：35/35 通过。
- `node scripts/run-electron-e2e.js tests/e2e/app-shell.spec.ts -g 'opens the View > Layout submenu and toggles the unified toolbar'`：1/1 通过。
- `node scripts/run-electron-e2e.js tests/e2e/navigation-and-resources.spec.ts -g 'opens relative Markdown links from every editor mode and follows their fragments'`：1/1 通过。
- `node scripts/run-electron-e2e.js tests/e2e/navigation-and-resources.spec.ts -g 'does not execute unsupported schemes from rendered document links'`：1/1 通过。
- `npx prettier --check`（本次涉及的组合、controller、pure-functions 和测试文件）及 `git diff --check`：通过。

文档链接迁移的第一次合并 E2E 命令曾因遗漏 `updateHoveredDocumentLinkCursor` 而在 `body[data-app-ready="true"]` 前超时；最小 Electron 诊断定位后，已由 `DocumentLinkNavigationController.updateHoveredCursor()` 接回，随后两个用例分别精确重跑为 1/1。该过程是已修复的迁移回归，不应伪装成一次全量通过，也不应作为当前全量门禁证据。

此前各职责单元的专项数字（settings persistence 6/6、settings dialog 7/7、recovery 12/12 与 Electron 4/4、external watcher 9/9 与相关 Electron 4/4、sidebar 2/2 与 Electron 4/4 等）已在 Tracker/对应提交上下文中记录；接班 Agent 重新修改相关代码后必须重新运行受影响范围。

### Tracker 记录的用户全量验证

Tracker 记录的 2026-09-04 用户 `npm run check:all`：`check` 完成；Electron E2E 首轮 150/151，有 1 条超时/失败，同一 HEAD 精确重跑该用例两次均为 1/1。精确重跑不等于干净全量通过，且该记录早于当前 `3f0499b`、`60ab08f` 之后的组合变化；当前 HEAD 的全量 `check:all` 尚未运行。

### 尚未完成的验证

- 当前 HEAD 的完整 `npm run check:all` 尚未运行，按用户约定留给用户手动执行。
- 批次 0 核心行为清单的人工逐项对比尚未完成，必须在所有代码迁移收口后由用户执行。
- Windows/macOS 实机和发布候选包不属于本批次自动化证据，按 Tracker 和 `docs/03-CROSS-PLATFORM.md` 递延记录。

## 9. 工作约定

1. **专项测试按需运行**：可运行需沙箱外权限的专项测试（单测、单条 E2E、build）。常用命令：`npm run build`、`npm test -- --run <test-file>`、`npm run check:vditor`、`npm run format:check`、`npm run lint`、`npm run typecheck`、`npm run typecheck:renderer`、`node scripts/run-electron-e2e.js tests/e2e/<file>.spec.ts -g "<name>"`。
2. **全量测试留给用户手动**：不要运行 `npm run check` 或 `npm run check:all`，除非用户明确改变该约定；专项结果不能写成全量结果。
3. **代码修改后同步文档**：把进度、真实测试结果和状态变更写入 `docs/15-0.2.5-EXECUTION-TRACKER.md`；涉及最终模块地图再更新 `docs/01-CODE-STRUCTURE.md`，涉及 adapter 假设再更新 `docs/06-VDITOR-UPGRADE.md`。用户可见行为变化才更新 `CHANGELOG.md`。
4. **不做 git commit**：接班 Agent 不要执行 `git add` / `git commit`；当前快照中的既有提交已经存在，后续改动留在工作区，由用户全量测试通过后按项目流程提交。
5. **开始前核对**：重新检查 `git status`、当前 HEAD 和 Tracker；若工作树含用户修改，保留并协作，不回退。

## 10. 批次结束要求

批次 9 完成前，在 Tracker 的批次 9 记录中说明：

- `app-composition.js` 中哪些函数已迁出、哪些跨域组合回调仍保留以及保留理由。
- 每个 controller 的协作边界、唯一状态写入者、bridge/adapter 输入和 runtime 资源 owner。
- listener、watcher、timer、rAF、observer、保存队列和异步 callback 的 cleanup 位置与迟到结果测试。
- 每个 Vditor 私有 DOM 假设对应的 adapter 测试和升级文档位置。
- 保存、冲突、删除/不可读、recovery、重绑、关闭、切换标签和编辑器重建的失败/竞态/泄漏证据。
- 每条专项验证的真实结果、当前 HEAD 用户全量验证结果、首轮失败与精确重跑记录，以及 Linux 与未验证平台边界。
- 全仓 `app.js` 删除条件、shell 测试迁移、构建产物核对和 app.js 职责映射表初稿。

完成上述代码、自动化和人工门禁后，将 Tracker 状态改为“已完成”；不要从批次 9 自动进入批次 10，等待用户启动下一批次。
