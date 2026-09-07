# 批次 9 工具栏专项与自绘光标交接文档

> 写给下一 Session 的 Agent。当前专项是收口批次 9 后的 Toolbar UX 调整；下一项已获产品方向确认的任务是自绘编辑光标。本文件只在 Session 开始时阅读一次；施工进度、问题和验证证据写入 `docs/15-0.2.5-EXECUTION-TRACKER.md`，不要在本文件追加过程记录。

## 1. 项目快照

- **仓库**：`/home/shawnzhang/Projects/Vditor-Electron`
- **分支**：`dev-0.2.5`
- **起始提交**：`b65bcd2a0b0b3ede55c95ab70f2e8c43d61c7075`（`docs: update related development documentation based on current codebase.`）
- **版本工作线**：`0.2.5`；批次 9 已完成 legacy `app.js` 移除，批次 10 尚未开始。
- **工作树**：含未提交的 Toolbar UX、sidebar 宽度及相关测试改动；不得重置、覆盖或混入无关格式化。
- **E2E**：Electron GUI 启动可能需要沙箱外权限；启动失败且断言尚未执行时应记录为环境限制，而不是产品失败。

## 2. 当前专项：Toolbar UX 调整

用户已人工验证当前 Toolbar UX 调整通过。工作树中与该专项相关的主要路径是：

- `docs/17-0.2.5-TOOLBAR-UX-ADJUSTMENT.md`
- `src/renderer/ui/sidebar-view-controller.ts`
- `src/renderer/ui/sidebar-layout-controller.ts`
- `src/renderer/index.html`、`src/renderer/styles/app.css`
- `src/renderer/app/app-composition.js`
- `src/main/ipc-validation.ts`
- 对应 unit / Electron E2E 测试。

已落实的产品约束包括：toolbar 显示时不显示 titlebar 投影；sidebar 显隐期间 navigation tabs 与 sidebar 同步；toolbar 填补 sidebar 消失后的空间；四个常驻按钮右边缘随 sidebar 移动；sidebar 最大宽度为应用窗口的三分之二（66%）。

**本专项下一步：**先保持当前工作树和用户人工验收结论，按用户指令决定是否补专项验证、更新 Tracker、提交或进入批次 10；不要借“自绘光标”任务重做 toolbar/sidebar。

## 3. 已撤销的错误方向

此前临时加入的“思源光标动画”试验已经撤销，不能恢复或作为后续实现基础。它曾：

- 在 adapter 中只监听键盘按键，画一条短暂的固定定位竖线；
- 同时改变了方向键后的滚动留白；
- 向 `EditorController`、composition、adapter 类型契约和 adapter 测试暴露了 `installCaretScrollAnimation`。

该方向不覆盖鼠标跨段落点击，不能维持静止态闪烁，也把导航滚动与光标视觉耦合，因而不符合产品目标。当前源码不应再出现 `installCaretScrollAnimation` 或 `data-vditor-caret-motion`。

## 4. 下一任务：自绘编辑光标

### 4.1 产品目标

在三个 Vditor 编辑模式（WYSIWYG、即时渲染 IR、分栏源编辑 SV）中，提供一个统一的视觉光标，且真实编辑行为仍由 Vditor / 浏览器原生 Selection 与 Range 负责。

- 样式下拉框放在设置页的“编辑器”分页，使用文字选项：`下划线 _`、`竖线 |`、`竖块 block`。
- 默认值必须在 `DEFAULT_SETTINGS` 中明确指定；建议默认 `竖线 |`，保持现有编辑器的常规预期。
- 设置应保存到 TOML 配置文件的 `[editor]` 节，而非 session 或 Chromium 用户数据。建议字段名：`caretStyle: 'underline' | 'bar' | 'block'`。
- 三种视觉样式均要有原地渐隐/渐显闪烁；方向键、Home/End/Page、鼠标点击不同段落导致的折叠插入点变化都应有一体化位移动画。
- 在选区非折叠、失焦、拖选、IME composition、窗口不可见、减少动态效果偏好下，视觉代理必须隐藏或立即停在正确位置，不能留下残影。

### 4.2 不可突破的实现边界

- **不能修改 Vditor 3.11.3 源码或打补丁。**Vditor 仍固定为 `3.11.3`。
- Vditor 私有 DOM、三种模式的可编辑根、Range 几何与滚动容器识别只能留在 `src/renderer/vditor-adapter.js`。
- 保留浏览器原生 Selection/Range 作为真实插入点；自绘层不得以 `getValue()` / `setValue()` 回写内容，不得破坏输入法、undo、复制、粘贴或 Vditor 选区恢复。
- 视觉层仅为 `aria-hidden`、`pointer-events: none` 的应用拥有 DOM；native caret 仅在自绘层正常运行时视觉隐藏，不能移除 contenteditable 或改变可编辑语义。
- 每个已初始化 tab 最多一个代理节点及一组监听器/rAF/WAAPI 动画；tab 关闭、Vditor 重建、模式切换、workspace 切换和应用关闭均须清理。

### 4.3 推荐施工顺序

1. 定义 `CaretStyle` 字面量联合和默认值：同步 `src/main/services/app-state.ts`、IPC `parseSettingsPatch`、`SettingsDocument.editor`、TOML 读写、renderer settings 类型与默认值；为非法枚举、旧 TOML 缺字段、重置默认值新增测试。
2. 在 `src/renderer/index.html` 的 `data-settings-panel="editor"` 放置文字 `<select name="caretStyle">`；在 `src/renderer/locales.js` 同时加入 `en_US`、`zh_Hans`、`zh_Hant` 标签与三个选项翻译。
3. 将该设置分类为 presentation/live editor，而非 constructor-only 设置：变更后不重建 Vditor，不丢失 undo、selection 或滚动位置。由现有 `SettingsRuntimeController` 的运行时分发调用一个窄 adapter 语义 API 更新已打开 tab。
4. 在 adapter 内实现稳定的折叠 Range 几何读取：普通文本、折行、空段落、`<br>`、元素前后边界、表格和 Vditor 模式差异都需兜底。不得在 renderer controller 外查询 `.vditor-*` 私有节点。
5. 在 adapter 安装统一 `CustomCaret` 生命周期：记录 pointerdown/keydown 前的旧 rect，在原生选区变更后的 `selectionchange` 和下一帧取得新 rect；静止态闪烁，位置变化时以 WAAPI 过渡；滚动时同步位置但不误触发文档间位移动画。
6. 首先在 WYSIWYG、IR、SV 分别手测并覆盖 adapter 单测；再添加针对真实 Electron/Vditor 事件链的 E2E。原生 caret 截图通常不稳定，E2E 应断言代理层生命周期和几何状态，动画视觉节奏保留人工验收。

### 4.4 三种形状的第一版几何规则

| 配置值 | 显示文字 | 第一版尺寸规则 |
| --- | --- | --- |
| `underline` | 下划线 `_` | 最小 8px 宽、2px 高，贴当前行的底部；后续可按后继字符 Range 精确测宽。 |
| `bar` | 竖线 `|` | 2px 宽、当前 caret 行高。 |
| `block` | 竖块 `block` | `max(0.55em, 8px)` 宽、当前行高，可使用主题前景色的半透明填充。 |

第一版不要试图重写浏览器的 glyph/caret 宽度模型；块状和下划线的精确字符宽度属于可单独验收的后续增强。

## 5. 现有设置与持久化路径

新增字段必须完整经过下列既有链路，不能只加表单：

1. `src/main/services/app-state.ts`：`AppSettings`、`DEFAULT_SETTINGS`。
2. `src/main/ipc-validation.ts`：`parseSettingValue()` 中按有限枚举校验，并列入允许 patch 的键集合。
3. `src/main/services/settings-store.ts`：`SettingsDocument.editor` 类型和 `toDocument()` 的 `[editor]` 持久化字段；旧配置缺字段时由默认值合并提供兼容。
4. `src/renderer/index.html` 与 `src/renderer/locales.js`：编辑器分页的文字下拉框与三语文案。
5. `src/renderer/settings/settings-controller.ts`：将其归类为非重建的 presentation/live-editor 影响；`SettingsRuntimeController` 已可从具名 `<select>` 读取、保存和恢复表单值。
6. `src/renderer/app/app-composition.js`：只做窄依赖注入和对已打开 editor 的协调；不在 composition 内保存 Range、listener、计时器或 Vditor 私有选择器。

## 6. 现成方案检索结论（2026-09-07）

检索过 npm 与公开实现，**不建议直接引入运行时依赖**：

- [`caret-pos`](https://www.npmjs.com/package/caret-pos) 可计算 `contenteditable` 和 textarea 的 caret 坐标，带 TypeScript 声明、零依赖，但最后发布于六年前；其“shadow caret”兜底会临时变异 DOM，不能直接用于 Vditor 的复杂三模式 DOM。
- [`vanilla-caret-js`](https://www.npmjs.com/package/vanilla-caret-js) 主要用于读写文本偏移，不提供视觉代理、动画或 Vditor 的结构适配。
- [`smooth-cursor`](https://github.com/kentocorin/smooth-cursor) 是面向 Google Docs / Overleaf 等站点的浏览器扩展/注入脚本；它依赖各站专有 DOM，不是可嵌入本项目的组件。
- CSS `caret-animation` 仅控制原生插入 caret 的闪烁行为，不能提供可控的 A→B 空间位移动画；三种形状和统一动画仍需要本项目自绘视觉代理。

结论：借鉴这些项目的 Range 坐标与 overlay 思路即可；实现应保持为 adapter 内部的小型原生 DOM/WAAPI 方案，不增加 npm 依赖、不引入 React/Vue 或替代编辑器。

## 7. 验收与验证

- **行为保持**：三个模式中的输入、中文/日文等 IME 组合、undo/redo、复制粘贴、鼠标拖选、查找、模式切换和 tab 重建与基线一致。
- **视觉行为**：三个样式均可保存、重启后恢复；静止闪烁；键盘与跨段点击均从旧位置连续过渡到新位置；滚动中无漂移、重影或跳回。
- **无障碍与降级**：`prefers-reduced-motion: reduce` 禁止空间移动和闪烁；失焦、非折叠选区和 composition 时无代理残留；高对比主题仍有足够可见性。
- **资源释放**：每个 cleanup 分支都覆盖关闭 tab、重建、切换 mode、dispose；连续选择变更应取消过期 rAF/WAAPI，不得累积节点。
- **自动化**：新增 adapter 几何和生命周期单测、设置 IPC/TOML 单测、针对真实 Electron/Vditor 的键盘与 pointer E2E。按需跑 `npm run typecheck`、`npm run typecheck:renderer`、adapter/settings 单测、`npm run build` 和相关 E2E；除非用户明确授权，不运行 `npm run check` 或 `npm run check:all`。

## 8. 首轮阅读顺序

1. `AGENTS.md`。
2. 本文件，然后不再重复读取。
3. `docs/15-0.2.5-EXECUTION-TRACKER.md`：只读第 5 节、批次 9/10 施工卡及第 10 节批次 9 记录。
4. `docs/17-0.2.5-TOOLBAR-UX-ADJUSTMENT.md`，只为当前专项收口。
5. `docs/01-CODE-STRUCTURE.md`：只读 renderer settings、editor/adapter 与 main settings persistence 相关章节，再以实际源码为准。
6. `docs/20-VDITOR-UPGRADE.md`：涉及新的 Vditor 私有 DOM 假设时必读并在实现后同步。
7. 实际源码与现有测试；文档不是源码真相。

## 9. 工作约定

1. 不修改 Vditor 源码、不升级 Vditor、不引入替代编辑器。
2. 不执行 `git add` 或 `git commit`；保留用户工作树。
3. 每次修改 adapter 公共 API 时，同步运行时 `Object.freeze` facade、`src/renderer/types/adapter.d.ts`、`src/renderer/types/adapter-contract.ts` 以及 runtime-key completeness 测试。
4. 本专项完成后更新 `CHANGELOG.md`、Tracker、必要时 `docs/01-CODE-STRUCTURE.md` 和 `docs/20-VDITOR-UPGRADE.md`；不要自动推进批次 10，等待用户指令。
