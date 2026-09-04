# 批次 8 交接文档

> 写给新 Session 的 Agent，启动 0.2.5 批次 8（工作区、设置、菜单、窗口与导出迁移）。本文件只在 Session 开始时阅读一次；施工进度、问题、测试证据和状态变更只写入 `docs/15-0.2.5-EXECUTION-TRACKER.md`，不要在本文件追加过程记录。

## 项目概况

- **仓库**：`/home/shawnzhang/Projects/Vditor-Electron`
- **分支**：`dev-0.2.5`
- **起始提交**：`b1bd3a4`（`0.2.5 B07 - independent B01 - B06 review and fix`）
- **版本**：`v0.2.0`（`bfaf25a`）是行为基线；当前进行 0.2.5 渲染层架构重构。
- **环境**：Fedora Workstation Linux，Electron E2E 可正常运行；不是容器或 Chromium socket 受限环境。
- **参考 worktree**：`../Vditor-Electron-0.2.0-reference`（detached @ `bfaf25a`；批次 11 前保持不动）。

## 前置条件

- 批次 1-6 已完成：renderer 构建与基础 UI、AppStore/快照、文档生命周期、编辑器 runtime，以及继续自研 AppStore 的决策均已落地。
- 批次 7 已完成独立复核和修复，解决 document/runtime 接线、状态所有权、selector 可观察性、关闭/保存/recovery/upload 的迟到操作和 runtime cleanup 问题。
- 用户在批次 7 提交后运行的干净 `npm run check:all` 通过：441/441 Vitest、148/148 Electron E2E；完整证据和此前一次资源敏感 E2E 波动记录均在 Tracker。
- 当前源码与 Tracker 是事实来源；不要根据本文件的概述反向修改既有实现。

## 批次 8 范围

按 Tracker 中的有序步骤实施，先完成一个有清晰边界的职责单元及其定向测试，再进入下一个：

1. `WorkspaceController` 和 `ExplorerController`：工作区根、树读取/刷新、工作区 watcher 事件、树 UI、展开状态、右键菜单和目录命令。
2. `SettingsController`、`SettingsWindow`、`LocalizationController`：设置草稿、验证、保存/重置、设置影响分类、应用级本地化和 cleanup。
3. `state.json`：将 session、recent、工作区展开状态、对话框目录及窗口/UI 恢复状态从 TOML 设置中分离，迁移必须幂等且安全降级。
4. `MenuController` 和 `WindowController`：菜单状态、窗口显示状态和非编辑器 context menu。
5. `ExportController`：HTML/PDF 导出、图片来源修复和输出写入。
6. 将本域源码字符串测试替换为行为测试，并完成 locale、设置热应用、工作区和导出回归。

不要重做设置页、文件树或菜单视觉；不要修改导出格式；不要重写批次 4 文件安全语义或批次 5 编辑器 runtime。

## 现有归属与迁移目标

`src/renderer/app.js` 仍是 legacy 组合层，其中以下职责属于批次 8 的迁移对象：

- `setWorkspace()`、`refreshTree()`、目录/文件创建、重命名、删除、工作区 context menu 与 sidebar 文件树事件。
- 设置读取、草稿/弹窗、`queueSettingsSave()`、设置分类与应用、`applyLocale()`、主题/演示设置和应用级文案刷新。
- `setupAppMenus()`、状态栏/菜单交互、窗口控制、fullscreen/maximize 状态和非编辑器 context menu。
- `exportBodySnapshot()`、HTML/PDF 导出、导出图片 portable/data URI 处理。
- `init()` 中设置、工作区/session/recovery 的组合顺序最终由批次 9 的 AppController 收口；批次 8 只迁出所属业务职责，不把新的业务逻辑堆入 `main.ts`。

已完成的文档和编辑器域不要重新实现：`src/renderer/documents/` 保留 canonical identity、保存、关闭、外部变化和 recovery 安全语义；`src/renderer/editor/` 保留 Vditor、runtime、auto-save 和 editor-owned DOM 生命周期。

## 不可突破的边界

- Vditor 固定为 `3.11.3`；所有私有 DOM、Range 和结构假设只能位于 `src/renderer/vditor-adapter.js`。
- 保持 `contextIsolation: true`、`nodeIntegration: false`；renderer 不导入 Node 内置模块，preload 只提供窄能力。
- Workspace/Explorer 不得直接修改 document、`fileIdentity`、保存基线、冲突或不可用状态；路径绑定变化必须通过 DocumentController 的命名 transition。
- EditorController 不得被设置、工作区、菜单或导出域绕过。展示类设置不得重建 editor 或清空 undo；确需重建的设置须有明确分类、理由和回归证据。
- `config.toml` 与 Chromium user data 保持分离；新增 `state.json` 不存 Vditor、DOM、observer、timer、Promise 或 recovery snapshot。恢复快照仍由现有 RecoveryStore 管理。
- 所有 IPC 参数、持久化状态、文件路径和导出内容都视为不可信输入；先验证/规范化，再执行特权操作。
- 新增 listener、watcher、timer、rAF、observer 或订阅必须有明确 owner 和 close/switch/rebuild/shutdown cleanup。
- Linux 通过不代表 Windows/macOS 验证；平台限制继续记录在 `docs/03-CROSS-PLATFORM.md`。

## 首轮阅读顺序

1. `AGENTS.md`。
2. 本文件，然后不再重复读取。
3. `docs/15-0.2.5-EXECUTION-TRACKER.md`：第 4、5、6、10 节以及批次 8 施工卡和批次 7 最终记录。
4. `docs/14-0.2.5-RENDERER-REFACTOR-PLAN.md`：共同原则、阶段 6、测试迁移和持久化相关章节。
5. `docs/01-CODE-STRUCTURE.md`：只读取 renderer、main/preload、设置、工作区、导出、持久化和测试相关章节。
6. `docs/05-FILE-SAFETY.md`、`docs/03-CROSS-PLATFORM.md`，以及涉及 Vditor 时的 `docs/20-VDITOR-UPGRADE.md`。
7. 实际源码、现有测试和 `v0.2.0` reference worktree；文档不是源码真相。

## 工作约定

- 在每个完成的职责单元后，将实施状态、发现、验证和遗留风险更新到 Tracker；本交接文档不再更新。
- 使用最小充分的定向验证。用户负责运行 `npm run check:all`；不要自行运行 `npm run check` 或 `npm run check:all`，除非用户明确改变该约定。
- 对可稳定复现的缺陷先增加聚焦回归测试；不要将资源受限或时序波动的单次 E2E 失败误报为产品问题。
- 不执行 `git add` 或 `git commit`；由用户在全量测试通过后提交。
- 开始批次 8 前重新检查 `git status`、当前 HEAD 和 Tracker；若工作树含用户修改，保留并与其协作，不回退。
- 每完成一个有序子步骤后，同步更新以下文档：
   - **`CHANGELOG.md`**：用户可见的行为变化；0.2.5 主要是内部架构变化，但仍需记录重要结构变化和修复。
   - **`docs/15-0.2.5-EXECUTION-TRACKER.md`**：批次执行记录（§10），包括实施进度、验证结果、遗留问题。
   - **`docs/01-CODE-STRUCTURE.md`**：代码架构全景；新增文件、目录、模块或职责边界时必须更新。
   - **`docs/20-VDITOR-UPGRADE.md`**：新增或变更 Vditor 私有 DOM 假设、adapter contract 或用户可见 Vditor workaround 时必须更新。
   - **其它受影响的文档**：文件安全、跨平台、主题等契约变化，分别同步 `docs/05-FILE-SAFETY.md`、`docs/03-CROSS-PLATFORM.md`、`docs/04-THEMES.md`。
