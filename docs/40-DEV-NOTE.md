# 功能实现：搜索与替换功能

## 实现版本：0.1.3

搜索与替换已实现，用于多个 agent 和对话之间同步实现边界，不是待开发 issue。

- `Ctrl/Cmd + F` 打开当前文档的搜索/替换浮层。
- 自绘 Edit 菜单和 macOS 原生 Edit 菜单使用相同的 `find` action。
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
  - `src/renderer/assets/replace.svg`
  - `src/renderer/assets/replace-all.svg`

## 测试入口

- `tests/unit/vditor-adapter.test.ts`：Range match、仅高亮/滚动与 Selection 行为。
- `tests/unit/renderer-shell.test.ts`：浮层、菜单、SVG 资源、快捷键、locale 和 adapter 契约。
- `tests/e2e/app.spec.ts` 的 `finds, navigates, and replaces text in the active document`：逐字符输入、焦点、计数、Custom Highlight、Enter 导航、关闭后 Selection、单项/全部替换、搜索框内保存到磁盘。

本轮验证：

- `npm run format:check` 通过。
- `npm run lint` 通过。
- `npm run typecheck` 通过。
- `npm run check:vditor` 通过。
- Vitest `74/74` 通过。
- Electron E2E `54/54` 通过。

## 后续约束

- 不直接包装、注入或改写 Vditor contenteditable DOM 来实现高亮。
- 后续加入大小写、全词或正则选项时，先扩展纯字符串匹配和测试；正则必须拒绝非法或可空匹配。
- 若增加 tab 独立搜索 session，应将 query、matches、index 和 tab ID 收束为一个对象，不能让旧 tab 的 Range descriptor 复用到新 tab。
