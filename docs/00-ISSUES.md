> [!NOTE]
>
> 本文档记录尚未关闭的版本问题，以及与版本无关的长期技术债、架构风险点、改进建议和不得回退的约束。已解决的 0.2.6 问题及其用户可见结果见 `CHANGELOG.md`；长期事项在关闭条件满足前继续保留。
>
> `docs/01-CODE-STRUCTURE.md` 是代码架构导航地图，不再维护技术债清单。

## SV 标题锚点滚动同步依赖 Vditor 3.11.3 私有 heading marker DOM

**状态：** 未决的 Vditor 4.0 升级风险；升级暂缓，未指定 Desktop 版本。若重新评估，按 [候选方案](TBD/VDITOR-4.0-MIGRATION-PLAN.md) 的阶段 3 和 [执行账本](TBD/VDITOR-4.0-EXECUTION-TRACKER.md) 的 SV 行为矩阵与增强结论验证。

0.2.6 的 `fe363d9` 为 SV 增加了 source → preview 标题锚点滚动同步：adapter 的 `syncSplitScroll()`（`src/renderer/vditor-adapter.js`，约 460 行）读取 Vditor 3.11.3 私有的 source heading marker（`[data-type="heading-marker"]`）与 preview `.vditor-reset` 的直接 H1–H6，仅在两侧标题数量相等时按顺序配对，并以各自 viewport 高度约 20% 处作为标题对齐里程碑在相邻锚点间插值；标题缺失、数量不等或私有 DOM 结构变化时不猜测映射，回退保留 Vditor 原生比例滚动，preview 滚动也不回写 source。

Vditor 4.0 的 SV 是 `<textarea>`，源码面不再提供可读取的 heading marker DOM，该私有依赖在升级后必然失效。风险不是崩溃而是能力丢失：回退路径会让 SV 退回上游按总高度的比例滚动，复杂 Markdown（原始 HTML、表格、图片、长代码块）中源码与预览的章节将重新错位。决定升级时必须给出明确结论——按 textarea/preview 映射重建标题锚点同步，或显式降级回比例同步并记录为用户可见行为变化；两者都不得保留依赖 3.11.3 marker 的隐藏失效路径，也不得以 DOM shim 在 textarea 上模拟 marker 结构。

## Mermaid 色调重绘依赖 Vditor 3.11.3 私有渲染入口

**状态：** 未决的 Vditor 4.0 升级风险；升级暂缓，未指定 Desktop 版本。若重新评估，在 [执行账本](TBD/VDITOR-4.0-EXECUTION-TRACKER.md) 的非 SV adapter 审查中记录复核结论。

0.2.6 的 `30de87d` 修复了壳层亮暗切换后已渲染 Mermaid 图表仍保留旧色调的问题：Vditor 3.11.3 的 `setTheme()` 不会重绘 `data-processed="true"` 的图表，Desktop 因此在 `ThemeCoordinator.applyTheme()` 中经 adapter `refreshMermaidTheme()`（`src/renderer/vditor-adapter.js`）重新调用 `window.Vditor.mermaidRender`，并依赖私有的 `.language-mermaid` 节点、`data-processed` 标记与该静态渲染入口。当前只能按“Markdown 围栏与已渲染节点数量相等时一一配对，否则不改动编辑器”收敛风险，无法消除对私有入口的依赖：3.11.3 没有公开的图表重渲染或主题刷新 API，而重建编辑器会丢失选区、undo 与滚动状态。

风险不是崩溃而是静默降级：若 4.0 改变节点结构、标记或渲染入口，图表将在主题切换后保留旧色调且 adapter 返回 `0`，除主题相关回归外无明显报错。关闭条件：在 4.0 上复核这三个私有契约并给出保留/重写/移除结论——若上游 `setTheme()` 自行重绘图表或提供公开重渲染入口，则删除 adapter 路径及其测试；否则迁移到新入口并保留“不配对即不改动”语义。证据为 `tests/unit/vditor-adapter.test.ts`、`tests/unit/renderer/theme-coordinator.test.ts` 与 `tests/e2e/app-shell.spec.ts` 的对应断言在 4.0 上仍然通过或按结论替换。升级验证项已记在 [`docs/07-VDITOR-UPGRADE.md`](07-VDITOR-UPGRADE.md)，根因与实现细节见 [`docs/09-DEV-NOTE.md`](09-DEV-NOTE.md#settheme-不重绘已渲染的-mermaid-图表)。

## 长期技术债与架构风险

### 显式技术债

| 文件                  | 现状                                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/main/index.ts`   | Linux `unmaximize` 后的多次延迟 bounds 复核是平台兼容 workaround，需在真实平台环境持续确认。                                  |
| `src/main/preload.ts` | 主窗口尚未启用 Electron sandbox：当前 CommonJS preload 依赖本地 `ipc-contract`；需要单独 bundled-preload 迁移与完整桥接回归。 |

### 架构风险点

1. **`app/app-composition.js` 集中度仍然偏高**：0.2.5版本批次 4–8 及批次 9 已把文档生命周期命令、编辑器 runtime、工作区、设置、菜单、窗口、导出、侧栏、文档链接、查找替换、大纲 DOM、应用 shell 资源、session 恢复和主题协调迁入独立 controller；组合层仍承担保存交易、标签命令、设置/session 组合、状态栏、对话框和部分全局事件的协调，批次 9 已收口、剩余组合交易属于过渡期遗留而非未完成迁移。

2. **IPC handler 仍集中在 `src/main/index.ts`**：当前仓库没有 `src/main/ipc/` 实现目录，所有 handler 由 `registerIpcHandlers()` 注册；这仍是拆分候选，但不应为此预先创建空模块。

3. **preload API surface 缺乏独立类型契约测试**：真实 Electron E2E 会覆盖当前桥接调用，但新增能力仍需同时更新 channel、preload、main handler 和行为测试。

4. **跨平台替换语义尚未实机验证**：文档安全写入已在 Linux 通过故障和 Electron 测试；Windows/macOS 对锁定目标、替换和大小写路径的真实语义按 [`docs/04-CROSS-PLATFORM.md`](04-CROSS-PLATFORM.md) 待实体机验证。

5. **`local-file://` 直接 handler 单测仍缺失**：受控根、URL/native-path、realpath 和 MIME 策略已有纯单测与 Electron E2E；协议层的直接 `Response` 单测仍可在后续测试维护中补充。

6. **非展示设置仍会触发全标签重建**：`saveSettings()` 已将主题、内容/代码主题、缩放和滚动条等展示设置分类为热应用；仍会对影响 Vditor 初始化契约的设置重建标签。重建期的 undo、滚动位置与模式状态已受保护，选区保护仍受 Vditor 3.11.3 上游限制（见 [`docs/09-DEV-NOTE.md`](09-DEV-NOTE.md) 的 undo/光标恢复记录）。

7. **部分 Vditor 私有 DOM 知识需继续审计**：`app/app-composition.js` 仍包含 editor 组合回调和少量 adapter 语义调用；新的 controller 不得重新引入 `VDITOR.selectors` 或未通过 adapter 暴露的 DOM 查询。

8. **Windows/Linux 无原生菜单**：仅 macOS 使用 `Menu.buildFromTemplate`（File / View / Tools 三组），其他平台完全依赖渲染器自定义菜单，原生集成度不对称。

9. **无近期文件 UI**：`recentFiles` 数据已写入 `state.json`，但无 UI 入口展示。

10. **已有目标仍存在最终替换 TOCTOU 边界**：安全写入器会携带 expected bytes 并在临近替换处复核，但当前 Node/Electron 文件 API 没有跨平台的通用原子 CAS；长期边界和关闭条件见 [`docs/06-FILE-SAFETY.md` §7](06-FILE-SAFETY.md#7-已知原子性边界已有目标的-toctou)。

11. **资源健康回收站仍存在路径化符号链接 TOCTOU 窗口**：`shell.trashItem(path)` 只接受路径字符串，复核与调用之间父目录仍可能被替换为符号链接。已通过“仅枚举直接图片文件 + 发现符号链接即只读禁用回收站”收束范围，但未消除该窗口；见 [`docs/06-FILE-SAFETY.md` §7.4](06-FILE-SAFETY.md#74-资源健康回收站路径化-shelltrashitem-的符号链接窗口) 与 [`docs/ARCHIVED/18-0.2.5-RESOURCE-HEALTH.md` §6.3.1](ARCHIVED/18-0.2.5-RESOURCE-HEALTH.md#631-符号链接与二级目录)。

12. **设置模型仍有无效字段**：`scrollSync`、`headingAnchor`、`previewTextWidth`、`tabString` 仅保留于默认值、TOML 白名单和 IPC 校验中，没有设置 UI 或功能消费者；`tabString` 还残留无对应控件的 locale key。为兼容现有 `config.toml` 暂时保留。关闭条件是后续独立版本逐项决定实现或移除，并验证旧 TOML 键的读取、再次保存和 IPC 校验行为。

### 改进建议（按优先级）

**P1（功能/安全）：**

1. 为 `local-file://` 补充直接 protocol handler 的纯 `Response` 单测，并完成 Windows/macOS 实体机资源根、大小写、权限和 link 行为验证。
2. 在 `file:write` / `file:delete` handler 中增加路径授权校验。

**P2（架构）：**

3. 将 `index.ts` 中的 IPC handler 分拆到职责明确的模块，保持 `src/main/ipc/` 只在确有边界时建立，不创建空壳目录。

**P3（功能完善）：**

4. 实现近期文件列表 UI。
5. 为 `app:openExternal` 补充 URL 长度上限校验。格式校验已由 `src/main/validated-url.ts` 实现（拒绝非字符串、首尾空白、原始控制字符和非法百分号编码），本条只剩长度边界未定。
6. 补充缺失的 Windows/macOS 发布配置。
7. 主题切换时避免为没有 Mermaid 的文档读取全文：`ThemeCoordinator.applyTheme()` 目前对每个已初始化 tab 无条件调用 `vditor.getValue()` 再交给 adapter 解析围栏，而 adapter 在无围栏时直接返回 `0`；大文档或多标签时这是一次无收益的全文序列化。关闭条件：经 adapter 语义接口（例如 `hasRenderedMermaid(host)`）先判定再读取正文，或缓存围栏来源，并补充大文档/多标签的耗时证据与对应单测；不得为此把私有 selector 上提到业务层。

### 已收口结论与不得回退的约束

以下事项已经实施完成，保留在此处作为约束，不作为待办：

- `app/app-composition.js` 的模块化拆分已到达合理边界（判据见 [`docs/09-DEV-NOTE.md` 的“模块化重构边界”](09-DEV-NOTE.md#模块化重构边界)）；剩余保存交易、标签命令、设置/session 组合、状态栏、对话框和应用壳事件的进一步迁入属于后续迭代的架构演进，保持无框架的原生 DOM 架构。`src/renderer/app.js` 已删除，不得恢复。
- 设置分类已收口：仅影响展示的设置走 `applyPresentationSettings()` 热应用；影响 Vditor 初始化契约的设置重建时已保护 undo（`captureUndoHistory()` / `scheduleUndoHistoryRestore()` 移交）、滚动位置（`createRebuildSnapshot()` 与滚动恢复）与模式状态。
- toolbar mount 兼容逻辑已收回 `vditor-adapter.js`（`mountedToolbar()` / `hasListMarker()`），adapter 不再对外导出 `selectors` 常量集合；业务代码不得重新引入私有 selector 查询。
