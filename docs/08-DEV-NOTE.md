# 功能实现：搜索与替换功能

## 实现版本：0.1.3

搜索与替换已实现，用于多个 agent 和对话之间同步实现边界，不是待开发 issue。

- `Ctrl/Cmd + F` 打开当前文档的搜索/替换浮层。
- 搜索/替换通过 `Ctrl/Cmd + F` 触达；当前新版菜单不再提供独立的 Edit 顶部菜单。
- `Enter` / `Shift+Enter`、`F3` / `Shift+F3`、上下按钮循环导航匹配项。
- `Escape` 关闭浮层，并将当前匹配作为 Vditor Selection 交还编辑器。
- 替换行默认折叠，支持单项替换和全部替换。
- `Ctrl/Cmd + S` 在搜索或替换输入框聚焦时仍保存当前文档。

## 搜索语义

搜索和替换的真相来源是活动标签的 `tab.content` Markdown 字符串，不是整个 renderer DOM，也不调用浏览器原生页面搜索。

- 三种 Vditor 模式有一致的计数和替换结果。
- 分栏模式不会将源码和预览重复计数。
- 不会搜索菜单、设置、侧边栏或隐藏标签。
- 当前为大小写不敏感的字面量、非重叠匹配；空查询显示 `0 / 0`。
- 不支持正则、全词或大小写敏感选项。
- 打开浮层前若编辑器选区没有换行，会预填为搜索词。

核心逻辑在 `src/renderer/app.js`：

- `collectFindMatches(content, query)` 计算 Markdown offset 匹配。
- `refreshFind()` 管理匹配集合、当前索引和计数。
- `moveFindMatch(direction)` 处理循环导航。
- `openFind()` / `closeFind()` 管理浮层、选区和焦点。
- `replaceFindMatch()` / `replaceAllFindMatches()` 基于 Markdown 字符串生成新内容。

## Vditor 高亮与定位

Vditor 3.11.3 没有公开的 find/search API 或按 Markdown offset 设置选区的 API。搜索功能所需的 Vditor DOM 访问必须在 `src/renderer/vditor-adapter.js` 中完成。

adapter 负责：

1. `activeEditor()` 获取当前模式的编辑区域。
2. `textMatches()` 一次扫描可见文本节点并创建可复用的 DOM Range descriptors。
3. `highlightTextMatches()` 使用 CSS Custom Highlight API 注册全部匹配和当前匹配。
4. `revealTextMatch()` 用当前 Range 滚动到匹配项，但不修改浏览器原生 Selection。
5. `selectTextMatch()` 仅在关闭搜索浮层时将当前 Range 设为 Vditor Selection。

样式使用：

- `::highlight(vditor-desktop-find)`：当前编辑模式中可映射的全部可见文本匹配。
- `::highlight(vditor-desktop-find-active)`：当前编辑模式中可映射的当前可见匹配。

搜索框聚焦时，浏览器原生 Selection 应属于输入框；编辑区的可见当前项由 active Custom Highlight 保持。不要在搜索框打开期间调用 `selectTextMatch()`，否则 Vditor/contenteditable 会抢走输入焦点。

注意：匹配计数和替换以 Markdown 为准，富文本模式的可见文本可能不含 Markdown 标记、链接地址等内容，因此可见高亮数量不保证与 Markdown 计数完全相同。SV 对普通文本定位最可靠；IR/WYSIWYG 的可见定位是 adapter 的受控兼容行为。

## 键盘与焦点边界

搜索输入与 Vditor 的异步渲染/键盘处理存在竞争，以下规则不可删除：

- 输入时立即基于 `tab.content` 更新计数；禁止在输入路径调用 `currentContent()` 或 `vditor.getValue()`。
- Vditor DOM 的 Range 高亮和滚动约防抖 `120ms`，避免每个字符都触碰编辑器 DOM。
- 搜索浮层打开时，`#findWidget` 的 `focusout` 会在焦点异步离开整个浮层后将焦点拉回 `#findInput`。
- window capture 阶段隔离以 `#findWidget` 内控件为目标的 `keydown`，避免 Vditor 和 document 快捷键同时处理输入。
- 该隔离层显式处理 Enter、Escape、F3/Shift+F3 和 Ctrl/Cmd+S；普通字符不调用 `preventDefault()`，应由浏览器插入输入框。
- 搜索浮层打开时不应让编辑器 `input` 回调自动重算 search session，否则会覆盖导航索引。

## 替换与保存

替换不直接改写 Vditor DOM：

1. 根据当前 Markdown match `{ start, end }` 创建完整 `nextContent`。
2. 调用 `setValue(nextContent)` 更新 Vditor。
3. 调用 `onEditorInput(tab, nextContent)` 更新 modified、标签、状态栏、大纲和自动保存状态。
4. 用 `nextContent` 立即重算匹配，不从 Vditor 同步回读。

`replaceAllFindMatches()` 从后向前替换，避免前面的 offset 因字符串长度变化失效。

Vditor 的 `setValue()` 异步重渲染，`getValue()` 可能暂时返回旧 DOM 内容。`applyFindContent()` 设置 `tab.pendingEditorContent`，保存时以已更新的 `tab.content` 为准；只有后续真实用户 `onEditorInput()` 收到不同内容时才清除该标记。

## UI 与资源

- 浮层结构：`src/renderer/index.html` 的 `#findWidget`。
- 样式：`src/renderer/styles/app.css` 的 `.find-widget` 和 `::highlight` 区段。
- 本地化：`src/renderer/locales.js` 的 `find.*`、`menu.find`，包含 `en_US`、`zh_Hans`、`zh_Hant`。
- 替换图标来自 VS Code 源码，已复制到：
   - `src/renderer/assets/symbolic/replace.svg`
   - `src/renderer/assets/symbolic/replace-all.svg`

## 测试入口

- `tests/unit/vditor-adapter.test.ts`：Range match、仅高亮/滚动与 Selection 行为。
- `tests/unit/renderer-shell.test.ts`：浮层、菜单、SVG 资源、快捷键、locale 和 adapter 契约。
- `tests/e2e/editor-modes.spec.ts` 的 `finds, navigates, and replaces text in the active document`：逐字符输入、焦点、计数、Custom Highlight、Enter 导航、关闭后 Selection、单项/全部替换、搜索框内保存到磁盘。

本轮验证：

- `npm run format:check` 通过。
- `npm run lint` 通过。
- `npm run typecheck` 通过。
- `npm run check:vditor` 通过。
- Vitest 单元测试通过。
- Electron E2E 通过。

## 后续约束

- 不直接包装、注入或改写 Vditor contenteditable DOM 来实现高亮。
- 后续加入大小写、全词或正则选项时，先扩展纯字符串匹配和测试；正则必须拒绝非法或可空匹配。
- 若增加 tab 独立搜索 session，应将 query、matches、index 和 tab ID 收束为一个对象，不能让旧 tab 的 Range descriptor 复用到新 tab。

---

# 功能实现：工作区 UI 改版

## 实现版本：0.1.3

## 当前状态

核心工作区 UI 已在 0.1.3 实现并通过自动化回归。文件保存原子化、工作区外 watcher、删除/目录移动恢复和跨重启冲突恢复不属于本轮已交付范围，见 `docs/12-0.2.0-DEVELOPMENT-PLAN.md`。

## 顶部结构

新版界面将原本独立的窗口标题栏、文件操作栏和标签栏收束为统一顶部工作区栏：

```text
Vditor Desktop menu | Sidebar | New / Open / Save | Tabs / New Tab | Window controls
Files / Outline | Fixed Vditor toolbar
Sidebar | Editor
Status bar
```

- `#windowTitlebar` 是应用菜单、侧边栏开关、文件操作、标签栏和窗口控制的唯一顶部栏。
- `#tabBar` 已移入 `#windowTitlebar`，文档标签和新建标签按钮在左右控制组之间弹性排列。
- `header.titlebar` 保留为第二行，只包含 Files/Outline 视图切换与 `#vditorToolbarMount`。
- Vditor 固定工具栏可通过现有 `toolbarVisible` 隐藏；隐藏后编辑区直接向上扩展。

## 侧边栏与标签

- `sidebarVisible` 是侧边栏、顶部文件操作组和第二行 Files/Outline 切换组的单一状态来源。
- 侧栏使用 transform overlay 而不是宽度动画：显示时 sidebar 覆盖仍为全宽的 Vditor 并在结束后才回归 flex；收起时保留原 flex 占位直到滑出结束，随后才释放编辑区宽度。这避免长文档在动画每帧重排；收起途中左侧的短暂空白是该顺序的预期视觉取舍。
- `#app.sidebar-transitioning` 标识完整过渡，`sidebar-opening` / `sidebar-closing` 标识 sidebar 的方向，`#app.sidebar-hiding` 保留顶部区域供退出动画，稳定隐藏态才使用 `#app.sidebar-collapsed`。动画中再次切换依据 `sidebarVisible` 的目标状态反向；`transitionend` 和 timeout 回退都必须清理这些临时状态。
- 过渡前后以 Web Animations API 的 transform 补间 `#tabBar`、`#vditorToolbarMount` 和 `#editorArea` 的视觉位置。编辑区只根据持久化的 sidebar 宽度计算目标位移，不会为了测量而临时展开 sidebar；编辑区和 Vditor host 不会在动画逐帧 resize，结束后才落入最终 flex 宽度并取消补间。Files/Outline tabs 的容器阴影不参与 opacity 动画，容器以 clip-path 收放可见空间；其按钮单独执行 opacity/transform 动画，因此保留显隐反馈而不会在结束时出现阴影透明度、大小或占位跳变。无标签状态在过渡中为 `.main-area` 补与 `#editorArea` 相同的背景；`#vditorToolbarMount::before` 绘制随 FLIP 移动、覆盖 toolbar 与暴露区域的连续底层表面，真实 toolbar/skeleton 位于其上层并保留原始边界。隐藏工具栏时，`#windowTitlebar::after` 用相同方向的 transform 保持标题栏 2px 阴影边与编辑区同步，所有 titlebar 子项保持在该阴影层之上。最终 flex 宽度提交后直接稳定呈现；不缩放文字，也不为渐变复制长文档 DOM。空状态提示及其操作按钮必须 `user-select: none`。
- 拖动 sidebar 右缘时，mousedown 必须阻止默认 blur；mousemove 仅用 rAF 合并 sidebar/chrome 宽度写入，并把动态 CSS 变量限制到其消费 chrome。活动 Vditor host 暂存并冻结 inline `inset`、`left`、`width`、`transform`，mouseup 才恢复，使长文档最多发生一次最终 reflow；不要将 drag state 或每帧 CSS variable 写到 `#app`，也不要在 drag 期间计算文件名长度。
- Files/Outline tabs 与 titlebar 文件操作不再过渡尺寸，而以 opacity + transform 显示和隐藏；`prefers-reduced-motion` 同时缩短其 keyframe animation。菜单和快捷键仍可访问文件操作。
- 标签渲染仍由 `renderTabs()` 负责。每个 `.document-tab` 启用原生 drag-and-drop，拖放时仅重排 `state.tabs`，再调用 `renderTabs()` 和 `persistSession()`；不销毁或重建 Vditor。
- 每次渲染标签后，活动标签通过合并后的双 `requestAnimationFrame` 再调用 `scrollIntoView()`，让长文档初始化的样式工作先完成而仍保持横向滚动区可见。
- Vditor `after` 不同步读取底部 spacer 或工具栏高度；`ResizeObserver`/延后帧负责最终测量，避免在长文档 DOM 初始化回调中制造应用侧全量样式计算。
- 文件树支持工作区内自动编号新建、内联重命名、回收站删除和从空白区右键菜单打开工作区；文件与文件夹分别维护 `Untitled x` 序号，文件序号会避开当前目录和已打开标签中的同名 Markdown 项。文件名与大纲标题同样使用浏览器原生末尾省略，完整文本保留在 DOM 和 `data-tooltip`，不做 canvas 测宽或中间截断。
- 工作区 watcher 对干净标签自动重载，对有本地修改的标签显示持久冲突横幅并暂停自动保存；当前机制不是完整的文件一致性或恢复系统。

## 菜单与平台

- renderer 自绘顶部菜单收束为一个 Vditor Desktop 下拉菜单，按文件、编辑模式、设置和退出分组。
- macOS 原生菜单删除 Edit、Theme、Help，保留 File、View 及原生 `F11` fullscreen。
- 搜索/替换仅通过 `Ctrl/Cmd + F` 触达。
- 顶部交互元素都使用 `-webkit-app-region: no-drag`；窗口栏保留空白拖拽区域。macOS 继续为原生 traffic lights 预留左侧安全区。

## 快捷键归属与冲突边界

### 应用快捷键

`Cmd` 表示 macOS，`Ctrl` 表示 Linux/Windows。`globalShortcut` 未使用；除 `F12` 外，应用命令在 renderer `keydown` 中处理。native menu 仅在 macOS 注册相同的 File/View accelerator。

| 应用动作                   | 快捷键                                           | 约束                                                                          |
| -------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| 新建文件                   | `Ctrl/Cmd+N`                                     | 应用命令                                                                      |
| 打开文件                   | `Ctrl/Cmd+Alt+O`                                 | 不占用 Vditor 的有序列表 `Ctrl/Cmd+O`                                         |
| 打开文件夹                 | `Ctrl/Cmd+Alt+K`                                 | 不占用 Vditor 的链接 `Ctrl/Cmd+K`                                             |
| 保存 / 另存为              | `Ctrl/Cmd+S` / `Ctrl/Cmd+Shift+S`                | 应用命令                                                                      |
| 关闭标签 / 关闭窗口 / 退出 | `Ctrl/Cmd+W` / `Ctrl/Cmd+Shift+W` / `Ctrl/Cmd+Q` | 关闭窗口 accelerator 仅由 macOS 原生菜单注册；其余为应用命令                  |
| 切换资源管理器             | `Ctrl/Cmd+Alt+B`                                 | 不占用 Vditor 的加粗 `Ctrl/Cmd+B`                                             |
| 查找和替换 / 设置          | `Ctrl/Cmd+F` / `Ctrl/Cmd+,`                      | 查找框内的 `F3`、`Shift+F3`、`Enter`、`Escape` 和 `Ctrl/Cmd+S` 为局部命令     |
| 上下文 / 全文选择          | `Ctrl/Cmd+A`                                     | Desktop 有意提供“当前上下文 → 全文”两段式选择；非编辑控件保留原生全选         |
| 全屏                       | `F11`                                            | 应用命令                                                                      |
| Chrome DevTools            | `F12`                                            | main `before-input-event` 始终拦截；仅 `devToolsEnabled` 为真时切换           |
| UI / 编辑区 / 预览区缩放   | 无                                               | 只能从设置页调整；不得重新加入 Electron `zoomIn`、`zoomOut`、`resetZoom` role |

### Vditor 3.11.3 默认快捷键

| 类别       | 快捷键                                                                   | 动作                                                            |
| ---------- | ------------------------------------------------------------------------ | --------------------------------------------------------------- |
| 工具栏格式 | `Ctrl/Cmd+E/H/B/I/D/K`                                                   | 表情、标题菜单、加粗、斜体、删除线、链接                        |
| 列表与块   | `Ctrl/Cmd+L/O/J`、`Ctrl/Cmd+Shift+I/O`、`Ctrl/Cmd+;`、`Ctrl/Cmd+Shift+H` | 无序列表、有序列表、任务列表、减少/增加缩进、引用、分隔线       |
| 代码与结构 | `Ctrl/Cmd+U/G/M`、`Ctrl/Cmd+Shift+B/E`                                   | 代码块、行内代码、表格、在当前块前/后插入                       |
| 历史与视图 | `Ctrl/Cmd+Z/Y`、`Ctrl/Cmd+'`、`Ctrl/Cmd+P`                               | 撤销、重做、Vditor 全屏、双面板预览                             |
| 标题与模式 | `Ctrl/Cmd+Alt+1…6`、`Ctrl/Cmd+Alt+7…9`                                   | 标题级别 1–6；WYSIWYG、IR、SV 模式                              |
| 表格上下文 | `Ctrl/Cmd+=`、`-`、`Shift+=`、`Shift+-`、`Shift+F/G/L/C/R/U/D/X`         | 行列增删、对齐和表格/块的上下文操作；仅对应模式和表格状态下生效 |

Vditor 的 `keydown` 会先在编辑器 host 内运行。document 级应用监听必须先检查 `event.defaultPrevented`；这保证将来新增的 Vditor 编辑器快捷键不会继续触发同键的应用命令。`Escape` 与 `F3` 的应用优先级只在可见弹层或查找框内生效，属于有意的局部焦点行为，不是编辑器冲突。

## 实现模块

- 结构：`src/renderer/index.html`
- 布局、应用主题、收放动画、拖拽视觉状态：`src/renderer/styles/app.css`
- 侧边栏联动、标签排序、菜单和快捷键：`src/renderer/app.js`
- macOS 原生菜单：`src/main/menu.ts`
- 文案：`src/renderer/locales.js`
- 回归：`tests/unit/renderer-shell.test.ts`、`tests/e2e/*.spec.ts`

---

# Vditor 3.11.3：模式切换与工具栏内部耦合

## 记录版本：0.1.5

## 现象

Desktop 侧栏已作为唯一的大纲入口，原生 Vditor 大纲面板关闭且入口隐藏。实现过程中确认：Vditor 3.11.3 的 `setEditMode()` 仍会直接读取并显示/隐藏 `outline` 工具项，即使 `outline.enable` 为 `false`。

另一个关联现象发生在从 WYSIWYG 或 IR 切入 SV：Vditor 会隐藏 `outdent`、`indent`，并为它们加上 disabled class；但 Desktop 在 SV 中自行基于 source selection 实现列表缩进。若在模式切换后再异步恢复这两个按钮，会造成工具栏内容在一个切换中发生两次布局更新，表现为轻微的内容闪烁。

## 失败尝试与原因

1. 从 Vditor toolbar 配置中直接移除 `outline`。

    - 失败原因：Vditor 的私有模式切换实现仍假定该项存在，会继续访问其内部 toolbar 元素；关闭大纲面板不等于移除该内部结构。

2. 在 Vditor 切换模式后的 `setTimeout(..., 50)` 中调用 `syncSplitToolbarActions()`，把 SV 的 `outdent` / `indent` 改回 `display: block` 并移除 disabled class。

    - 失败原因：Vditor 已在同步切换中把按钮隐藏，50ms 后应用再次改变 display，形成“先隐藏、再插回”的两阶段工具栏重排。功能可用，但 WYSIWYG/IR → SV 可见闪烁；快捷键切换也不应依赖鼠标点击后的补偿路径。

## 正确处理方法

- 保留 `outline` 作为运行时内部 toolbar 项，`outline.enable: false` 禁用原生面板；由 `vditor-adapter.js` 为该私有项添加应用 data attribute，再用应用 CSS 的 `display: none !important` 隐藏入口。
- adapter 在初始化时为 `outdent` / `indent` 添加稳定占位 data attribute。应用 CSS 在 SV 中持续覆盖 Vditor 的隐藏和禁用外观；实际命令仍由 renderer capture 阶段的 source-selection 逻辑处理。
- 删除模式切换后的延迟 display 改写。应用仍可在延迟回调更新自身模式状态、行号和滚动位置，但不得再二次改变这两个工具栏项的布局。

## 注意事项与验证

- 所有 Vditor 私有 toolbar 查询、`closest()` 和 data attribute 标记必须留在 `src/renderer/vditor-adapter.js`；`app.js` 只调用语义化 adapter API。
- 这是 Vditor 3.11.3 的私有契约。升级 Vditor 时，须检查 `setEditMode()` 对 `outline`、`outdent`、`indent` 的显示和 disabled 行为，并同步更新 `docs/06-VDITOR-UPGRADE.md`。
- 回归覆盖：adapter 单测验证标记；Electron E2E 验证从 WYSIWYG 与 IR 切入 SV 时两个列表按钮只保留 Vditor 同步 show/hide 的两次 style 更新、不会再出现延迟补偿更新，且最终仍可见；另保留 SV 列表缩进/反缩进功能测试。
- 大纲对齐 Vditor 原生功能时，当前编辑区的直接 H1–H6 DOM 才是准则。Electron 验证显示 IR 对 Setext 和围栏内 ATX 样式文本的即时结果不等同于完整 Markdown 语义；因此不要把“原生等价”写成“完整 Markdown 标题解析”。若需跨模式一致的 Setext/围栏语义，应单独决策并实现独立 Markdown 解析与目标定位，不能隐式改变原生对齐范围。
- 原生对齐实现只保留一份 snapshot：preview 可见时取 preview，否则取当前模式编辑区。不要再把原生 DOM 标题、Markdown fallback 和另一套目标数组按下标拼接；集合不一致时行号、折叠 key 和跳转目标都会错位。Outline 视图隐藏期间无需调用 `getValue()` 或重建树，切换到该视图时再刷新即可。
- SV preview 在模式切换后异步渲染，不能用固定延迟补偿。由 adapter 的可清理 MutationObserver 监听模式 style 与内容变化并触发防抖刷新；标签重建、关闭时必须 disconnect，避免旧 host 与回调泄漏。

## 模式切换后的内容位置只能近似对应

Vditor 3.11.3 切换模式时先序列化当前 Markdown，再分别通过 `Md2VditorDOM`、`Md2VditorIRDOM` 或 `processSpinVditorSVDOM` 重建目标模式的私有 DOM。三种模式没有共享的版面节点，也没有公开的跨模式源码位置到滚动坐标映射 API。

因此，即使 WYSIWYG 与 IR 使用相同内容主题，两者的标记展开、块结构和预览节点仍可能产生不同高度；包含复杂原始 HTML 的文档在 SV 源码与渲染模式之间高度差异更明显。Desktop 在切换前保存滚动进度，并在目标模式首帧绘制前按目标滚动范围恢复，从而避免闪回文档开头；恢复结果遵从 Vditor 各模式的实际排版，只保证近似文档进度，不保证同一语义节点严格对齐。

除非未来由 Vditor 提供稳定的源码位置映射能力，否则不要在 Desktop 层按私有 DOM 节点、HTML 文本或估算行高建立跨模式锚点。这会把上游模式差异变成更脆弱的应用层启发式，并在原始 HTML、表格、代码块和异步预览中产生新的偏差。升级 Vditor 时应重新检查模式转换 API；若上游新增稳定映射接口，再单独评估精确位置恢复。

## SV 行号与文档末尾留白必须分层

GNOME Text Editor 的 `EditorSourceView` 通过 `gtk_text_view_set_bottom_margin()` 提供与可见区域高度相关的 overscroll，行号仍由 GtkSourceView gutter 按文本 buffer 的实际行渲染。留白属于视图滚动范围，不属于文档内容，也不会生成行号。

Desktop 的对应实现保持同一边界：Vditor 3.11.3 的 `--editor-bottom` / `::after` 只负责 SV 的末尾滚动留白；应用 gutter 从 SV DOM 的原始文本生成逻辑行并剔除尾部换行，正文内部空行仍正常编号。Vditor 会在模式转换时规范化块分隔并序列化末尾换行，不能直接用 `getValue().split("\n")` 的尾部空 segment 生成行号。

SV 的原始 HTML marker 可在一个元素内包含多行和嵌套的 `data-type="newline"`；实际文本行数可能高于 marker 数，不能在 marker 用尽后按固定行高猜算，否则行号会延伸进 overscroll。行号位置应取逻辑源码行所有 client rect 中视觉最上方的 rect，不能假定 `Range.getClientRects()` 的第一个结果一定是行首；长行折行时，该假定会把行号放到换行标记末端。滚动监听还须跟随 Vditor 替换后的当前 SV 节点，并在旧节点上清理。

# Vditor undo 的连续编辑合并窗口

## 记录版本：0.1.5

Vditor 3.11.3 会以 `undoDelay`（Desktop 当前配置为 500ms）防抖写入 undo 栈。连续编辑若间隔不超过该窗口，会合并为同一个撤销步骤；例如先清空一个表格单元格、随即在表格外输入文字，单次 Ctrl/Cmd+Z 可能同时回退两项更改，并把光标恢复到该合并步骤保存的表格位置。

这不是 Desktop 的表格选择修复额外写入 undo 项，也不是内容损坏：等待超过 500ms 后再进行下一次编辑，两个操作会形成独立历史项，内容撤销结果正常。Desktop 遵从 Vditor 的原生连续输入分组行为，不为表格删除单独强制提交 undo 边界。

## 超过合并窗口后的光标恢复异常

即使每次编辑之间已等待超过 `undoDelay`，Vditor 3.11.3 的内容 undo 与光标恢复仍不是同一个可靠性等级。已人工确认的混合场景如下：

1. 在表格单元格内输入字符后删除；
2. 等待约 3 秒，确保该编辑已单独写入 undo 栈；
3. 在表格外的标题中输入字符，再等待约 3 秒；
4. 按 Ctrl/Cmd+Z。

标题中的字符会正确消失，但光标会回到此前编辑过的表格单元格；另有偶发情况会回到文首。因为等待已经超过合并窗口，这不是 `undoDelay` 造成的操作粘连。

上游实现的原因是 undo 快照通过私有 `wbr` 光标标记保存位置。`recordFirstPosition()` 只在初始 undo 状态记录一次选区，而 `renderDiff()` 在撤销时恢复上一条快照的标记；跨块、跨位置编辑时，该标记可以属于较早的表格编辑，而不是刚被撤销的标题编辑。标记缺失或结构重建后无法稳定定位时，Vditor 的 selection fallback 也不能保证预期位置；人工观察中包括光标回到文首。当前只记录可观察行为，不把文首情况归因到某一个未单独验证的上游分支。

该问题发生在没有 Desktop 表格整格选择接管的普通“输入后删除”路径，因此可确认是 Vditor 3.11.3 的上游光标恢复缺陷/限制，而非 Desktop 本轮修改造成。尚未对比更早 Vditor 版本或核对上游 issue 历史，不能把它表述为“版本回归”。Desktop 当前遵从 upstream：保证内容撤销正确，不在应用层用私有 DOM 猜测跨块光标位置。升级 Vditor 时应复核 `undoDelay`、`recordFirstPosition()`、`Undo.renderDiff()` 与跨块撤销后的光标恢复表现；若上游提供稳定选择位置 API，再单独评估修复。

## 编辑区右键菜单的 Vditor 私有表格边界

Vditor 3.11.3 没有公开的编辑器右键菜单或表格行列 API。WYSIWYG 的浮动工具栏和 IR 的键盘分支最终都依赖同一组内部 table DOM 操作；Desktop 不能伪造快捷键，也不能把 Markdown 整体取出、修改后再 `setValue()`，否则会丢失当前选区和 undo 上下文。

Desktop 因此只在 adapter 中保存/恢复编辑 Range、识别真实 `td` / `th`、执行与上游一致的行列 DOM 变化，并派发到 Vditor 当前模式的 input 处理器，使内容序列化、预览、修改状态和 undo 仍由 Vditor 负责。删除表头行按上游语义禁用；删除唯一一列让上游对应的 table 删除边界继续生效。任何 Vditor 升级都必须人工复核 WYSIWYG、IR 的四项操作、光标和 Markdown 输出，并单独观察 Vditor 自身 undo 行为；若上游提供稳定公共表格 API，应替换该私有适配。

当前自动化覆盖菜单可见性、Range 恢复和四项表格 DOM 结果；剪切、复制、两种粘贴和四项表格行列操作已完成人工验收。Vditor undo 栈及跨块光标恢复仍属于上游限制，不作为右键菜单能力承诺；不能把该场景改为 Desktop 自建 undo，或以 `getValue()` / `setValue()` 回写来伪造撤销，否则会越过 Vditor 的选区与历史边界。

右键菜单自身是应用层共享的 `#contextMenu`：文件树和编辑区不再争用不同容器。编辑菜单仅捕获当前活动标签的可编辑表面，SV preview、查找输入框、设置与文件树不被接管；菜单在视窗边界内定位，`Escape`、外部点击、标签/模式切换、重建和标签关闭都会清理保存的 Range。撤销/重做不在右键菜单中提供，继续使用 Ctrl/Cmd+Z、Ctrl/Cmd+Shift+Z 与 Vditor 工具栏，避免将 Vditor 3.11.3 的私有 undo 快照限制伪装成稳定的菜单命令。由于 Chromium 的 `execCommand('paste')` 不能可靠地向 Vditor 传递剪贴板数据，preload 只暴露 `readClipboard()`，由 adapter 构造 Vditor 既有的 paste 事件；纯文本粘贴不传递 HTML。

---

# Vditor 3.11.3：长表格编辑横向滚动补偿

## 问题与边界

Vditor `3.11.3` 的 WYSIWYG/IR 将表格本身作为横向滚动容器（`display: block; overflow: auto`）。在多字符输入、IME 多字提交或原生粘贴中，Vditor 会重建当前表格或父级块；新表格节点没有旧节点的运行时 `scrollLeft`，因而回到最左侧。

该行为在纯 Chromium 的固定 `3.11.3` 对照页中复现。保存的官方指南页也使用二进制一致的 `3.11.3` JS/CSS；其公开配置近似版仍复现。因此这不是 Electron 或 Rime 专有问题，Desktop 只补偿可观察的滚动状态，不接管 Vditor 的文本、选区、undo 或剪贴板语义。

## Desktop 策略

`vditor-adapter.js` 的 `preserveTableScrollDuringInput(host, getMode)` 在 `paste`、`input`、`compositionstart` 捕获阶段保存当前选区所属表格的序号、`scrollLeft` 和最大横向范围。它以短生命周期 `MutationObserver` 等待 Vditor 重建，在事件完成后恢复同序号表格；250ms 后或 tab 关闭时清理 observer、timer 和 animation frame。

恢复先保留用户原位置。若输入前已贴住右边界，恢复到新表格右边界；最后只在当前 Vditor selection 越出表格可视范围时移动最小距离以显示光标。这样不强制中间阅读位置跳到右端，也允许内容增长后继续跟随输入。

| 场景                         | Vditor 网页 3.11.3 | Desktop      | 处理原则     |
| ---------------------------- | ------------------ | ------------ | ------------ |
| 短单元格持续输入至超宽       | 跟随               | 跟随         | 上游行为     |
| 短单元格粘贴至首次超宽       | 不跟随             | 不跟随       | 不扩展范围   |
| 超长单元格右侧输入           | 跟随               | 跟随         | 上游行为     |
| 超长单元格右侧多字符粘贴     | 回到左侧           | 跟随         | Desktop 补全 |
| 超长单元格中间输入至光标越界 | 不跟随             | 最小距离右移 | Desktop 补全 |

## 维护约束

- 任何表格 DOM 查询、selection/Ranges 和重建兼容逻辑只能保留在 adapter；`app.js` 只负责安装并在 tab 关闭时调用 disposer。
- 不得以 `getValue()` / `setValue()` 回写全文修复滚动，否则会损害 selection、undo 和 mode 状态。
- 不得把短单元格首次粘贴超宽的“不跟随”单独修成另一套规则，除非产品另行决定偏离上游行为。
- Vditor 升级时按照 `docs/06-VDITOR-UPGRADE.md` 验证此私有契约；若上游已保留表格横向位置或提供公共 API，应删除本补偿。

---

# Vditor WYSIWYG 部分格式选区复制不保留语义

## 记录版本：0.2.5 / 2026-09-04

在 Vditor 3.11.3 的 WYSIWYG 中，视觉上选中加粗文本 `abc`（其 DOM 位于`<strong>` 内）后，通过 Ctrl/Cmd+C 或 Desktop 编辑器右键菜单 Copy 复制，再粘贴，结果为普通文本 `abc`。IR 中若连同 `**` Markdown 标记一起选中，复制结果为`**abc**`，粘贴后会恢复加粗；这不是两个 Desktop 菜单路径的差异。

上游 WYSIWYG `copy()` 对普通选区使用 `Range.cloneContents()`，再将得到的片段交给`VditorDOM2Md()`。当 Range 起止位置都在同一 `<strong>` 的文本节点内时，clone 的片段不包含该祖先元素，因而转换结果只能是 `abc`；上游还明确将 `text/html` 清为空。其代码只为 code 和 link 做了格式化特例，没有为 strong、em、del 或跨节点部分选区补回祖先语义。Vditor 的粘贴逻辑会正确解析输入的Markdown，但这里的剪贴板中已经没有可恢复的 Markdown 标记或 HTML。

本地 Vditor `v3.11.3` 标签与 Desktop 安装依赖的对应源码哈希一致。对比本地`v3.11.3..v4.0.0` 后，WYSIWYG/IR 的 copy handler 没有变化；4.0.0 不能修复此场景。

## Desktop 决策

这是 Vditor 的上游限制/缺陷，不是 0.2.5 renderer 重构回归。Desktop 不在 adapter 或菜单层补写祖先标签、HTML 剪贴板格式或 Markdown 包装：跨嵌套格式、部分链接、列表和代码边界的正确序列化属于 Vditor 编辑引擎职责，应用层猜测 Range 祖先会偏离上游并增加selection/undo 风险。后续仅在 Vditor 上游提供修复或稳定公开 API 时重新评估。

本轮 Electron 专项覆盖完整 Markdown 语义选区在 WYSIWYG、IR 中经快捷键及右键菜单Copy/Paste 的往返：剪贴板 HTML 为空，Markdown、粗体和列表语义保持一致。该测试不将上述已确认的上游限制编码为 Desktop 行为承诺。
