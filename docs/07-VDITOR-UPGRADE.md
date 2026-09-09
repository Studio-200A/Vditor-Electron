# Vditor 升级流程

Vditor Desktop 不修改 `node_modules/vditor` 的源码，但工具栏合并、SV 行号与空白字符、列表缩进、查找定位和大纲跳转依赖 Vditor 的内部 DOM。升级必须作为显式维护任务进行，不能随普通依赖更新自动合入。

## 兼容边界

- 公开 API 和初始化选项位于 `src/renderer/editor/editor-options.ts`（Vditor constructor-only 设置、离线资源、locale、relative-resource base 与回调接线）；Vditor 实例化与重建生命周期由 `src/renderer/editor/editor-controller.ts` 负责，其余业务代码不再直接构造 `new Vditor()`。
- JavaScript 使用的非公开 DOM 选择器和结构判断集中在 `src/renderer/vditor-adapter.js`。
- `src/renderer/types/adapter.d.ts` 是冻结 `window.VditorDesktopAdapter` facade 的严格类型边界；`src/renderer/types/adapter-contract.ts` 覆盖全部公开成员的编译期调用，并提供给单测比对的导出键 manifest。升级若增删或改签名，必须在同一改动中同步 runtime facade、声明、manifest 和契约测试；不得用宽泛类型或 overload 掩盖差异。
- Vditor 外观覆盖仍集中在 `src/renderer/styles/app.css` 的 Vditor integration 区段，它是升级时的第二检查面。
- `tests/unit/vditor-adapter.test.ts` 验证适配层自身，并将运行时冻结对象的全部导出键与类型 manifest（`src/renderer/types/adapter-contract.ts` 的 `ADAPTER_PUBLIC_KEYS`）精确比对；导出成员数量以该 manifest 为唯一事实来源，文档不维护计数。
- Electron E2E 中的 `Vditor DOM integration contract` 验证真实 Vditor 构建产物。
- code/content theme toolbar menu 的 hover tooltip 仅可通过 adapter 的 `clearToolbarHoverTooltips()` 清理；升级 Vditor 时须验证选择主题后 tooltip 正常收起。
- Vditor 3.11.3 的模式切换仍会操作内部 `outline` 工具项；adapter 保留该项作为不可见占位，并通过应用专用 data attribute 和 CSS `display: none !important` 隐藏入口。升级时须验证三种模式切换正常，且原生 outline 控制不出现。
- 同一私有切换路径会在 SV 中隐藏并禁用 `outdent` / `indent`；adapter 为它们设置应用专用稳定占位标记，CSS 保持按钮可见且应用捕获层处理 source-selection 缩进。升级时须确认 WYSIWYG/IR → SV 没有延迟二次工具栏重排，且 SV 缩进与反缩进仍可用。
- Desktop 大纲通过 adapter 复刻 Vditor `Outline.render()` 的 content-element 选择：preview 可见时读取其 `.vditor-reset`，否则读取当前模式编辑区，再枚举直接 H1–H6。升级时须验证三种模式的 snapshot、SV 双侧目标映射与原生顺序一致。
- Desktop 编辑区底部留白通过 adapter 向 SV、IR、WYSIWYG 与 preview 写入私有 CSS 变量 `--editor-bottom`；Vditor 3.11.3 的 SV/IR/WYSIWYG 使用尾部 `::after` 消费该变量，Desktop 为 preview 提供同等尾部元素。升级时须验证三种编辑模式、SV preview 及窗口缩放后的留白高度均约为编辑器实际高度的一半，且用户的 typewriterMode 设置语义不变。
- Desktop 的 SV divider 由 adapter 插入 Vditor 3.11.3 私有 `.vditor-content`，并以 source 与 preview 的实际 display 状态报告 source-only、preview-only、both 语义。升级时须验证 Vditor 异步 pane 替换后 divider 不重复、两单栏均隐藏 divider、both 中可拖动且关闭/重建不保留 window pointer listener。
- Desktop 的 SV 行号、空白符 canvas、滚动同步、列表缩进 selection 与自动缩进均经 adapter 访问私有 `.vditor-sv`、source line/Range、list marker/padding 和 capture `keydown` 路径。Vditor 3.11.3 的 `Ctrl/Cmd+Shift+I` 为减少缩进、`Ctrl/Cmd+Shift+O` 为增加缩进；它会在 SV 中禁用自己的 toolbar action，adapter 必须在 source 选区上执行同一语义。空白符 canvas 在重绘时以当前 viewport 坐标重新生成并归零旧滚动补偿 transform。升级时须验证长文档、空行、表格/HTML 源码、空白符开关、source 滚动、工具栏和两条快捷键的缩进/反缩进、非列表行 Enter 自动缩进；pane 替换、rebuild 或关闭后不得遗留 observer、rAF、scroll 或 keydown listener。
- Desktop 编辑区右键菜单通过 adapter 识别私有 WYSIWYG / IR table、保存与恢复编辑 Range，并按 Vditor 3.11.3 的表格 DOM 结构执行行列动作后重新进入其 mode-specific input / undo 路径。右键菜单不提供撤销/重做，仍使用 Vditor 工具栏和快捷键。升级时须验证三种模式的可编辑表面识别、SV preview 排除、四项表格操作、Markdown 输出、undo 与光标恢复；如上游公开表格 API，应优先评估替换该私有适配。
- Vditor 3.11.3 的 WYSIWYG/IR 会在 paste、input 或 composition 提交中重建当前表格，导致表格自身 `scrollLeft` 丢失。adapter 的 `preserveTableScrollDuringInput()` 在这些事件的捕获阶段保存位置，再以有界 observer 在重建后恢复，并仅在光标越出表格可视区域时作最小横向调整。升级时须验证该重建行为、长单元格右侧多字符粘贴、右侧连续输入和中间位置输入至光标越界；若上游保留滚动状态或提供公共 API，应删除该私有补偿而不是叠加两套恢复。
- Vditor 3.11.3 在编辑区的私有 `keydown` 路径直接处理 `Ctrl/Cmd+Alt+7/8/9`，并同步重建 WYSIWYG、IR 或 SV。adapter 的 `editModeShortcut()` 必须与该平台修饰键契约一致，使 Desktop 能在重建前保存文档位置、在重建后同步状态栏模式。升级时须验证三种快捷键均切换到正确模式，状态栏即时更新，且滚动位置不会回到文档顶部。
- 查找替换通过 adapter 的 `replaceTextMatch()` 选择 Vditor 3.11.3 当前可编辑表面中的匹配 Range，并触发其原生编辑/input 路径；不得改用整篇 `getValue()`/`setValue()`。带 SVG 策略缓存 URL 的图片须在 WYSIWYG 原生替换期间临时恢复原始 URL，避免 Vditor 3.11.3 序列化时丢失允许的 SVG。升级时须验证单次/全部替换、undo、选区、三种模式及允许 SVG 的保留均正常。
- 资源健康删除缺失图片引用通过 adapter 的 `removeImageReference()` 精确选择当前编辑表面的单个引用；SV 使用原始片段，IR/WYSIWYG 对重复本地 URL 保守拒绝。Vditor 3.11.3 的语义编辑没有键盘预备事件时，adapter 在编辑前后记录其私有 undo snapshot，仍由 Vditor 的 input/patch stack 恢复。升级时须验证取消/确认、未写盘、SV undo、单个渲染图片删除，以及重复 URL 的拒绝路径。
- Desktop 的应用快捷键必须与 Vditor 的组合键分离：打开文件/文件夹/侧栏使用 `Ctrl/Cmd+Alt+O/K/B`，缩放不注册 Electron menu role；渲染器只在事件未被 Vditor `preventDefault()` 时执行应用命令。升级时须复核 Vditor 默认工具栏和表格快捷键，尤其是 `Ctrl/Cmd+B`、`O`、`K`、`Shift+I`、`=`、`-` 和 `Shift+F`。
- Desktop 自绘光标通过 adapter 的 `installCustomCaret()` 读取三种模式的私有可编辑根和折叠 Range 几何；浏览器原生 Selection/Range 仍是唯一真实插入点。代理节点挂在 `#editorArea` 内以共享其 `overflow: hidden` 裁剪，滚动时先按 `scrollTop`/`scrollLeft` 增量同步平移、下一帧再用真实 Range 几何校正并重启闪烁，光标越出编辑面或 sidebar 拖动期间隐藏。表格内光标以编辑器根的行高计算几何并在越出表格可视区域时隐藏；IR 空块之间的折叠选区可报告零矩形，adapter 会瞬时插入零宽探针节点取得插入行几何后立即移除，不回写内容、不派发 input。升级时须验证普通文本、空段落、折行、IR 空块、表格和 SV 中的定位，并确认失焦、选区、IME、不可见窗口、rebuild 和 tab close 不保留代理节点、探针节点或隐藏原生光标。
- 初始化设置要求重建 Vditor 时，adapter 的 `createRebuildSnapshot()` 会临时克隆活动 host 的已渲染内容（同步全部后代 `scrollTop`/`scrollLeft`），直到新实例完成 toolbar/content 接管且滚动位置恢复稳定后才移除，避免空白闪烁与闪回开头。升级时须验证 snapshot 不包含重复 ID、不会接收交互、失败路径会释放，且 toolbar 与内容在重建期间无可见空白。
- 重建移交 undo 历史依赖 Vditor 私有 undo 契约：`captureUndoHistory()` 在销毁旧实例前调用其私有 `vditor.undo.addToUndoStack()` 冲洗 `undoDelay` 防抖中尚未到期的输入历史，并只在 `resetIcon`/`undo`/`redo` 结构完整时返回该私有 owner；`scheduleUndoHistoryRestore()` 在新实例 `after` 后等待 `undoDelay + 25ms`（让 Vditor 先排队其初始 undo 基线）再替换 `vditor.undo` 并调用私有 `resetIcon()`。升级时须验证 constructor-only 设置重建后 Ctrl/Cmd+Z 与工具栏撤销仍能回退重建前的编辑、首次撤销不会只移除 Vditor 内部光标标记，且重建前 500ms 内的输入不丢失；若上游公开 undo 栈迁移 API，应替换该私有移交。
- SVG 渲染开关变更时，adapter 的 `reloadImageSources()` 假定 Vditor 3.11.3 会把三种模式中的 Markdown 图片保留为 host 内的 `img[src]`。升级时须验证本地与 HTTP(S) SVG 在开关关闭时不显示、开启后无需重建编辑器即可显示，且既有 undo 与选区不受影响。

业务代码不得新增 Vditor 内部选择器；确有需要时，先加入适配层和契约测试。

## 升级步骤

1. 新建单独升级分支，阅读目标版本变更记录。
2. 使用精确版本安装：`npm install --save-exact vditor@<version>`。
3. 同步 `src/main/index.ts` 中关于页版本号。
4. 检查目标包 `dist/index.css`、工具栏、SV、IR、WYSIWYG 和 preview DOM 变化。
5. 先运行 `npm run check:vditor` 和 `npm run typecheck:renderer`，再运行 `npm run check:all`。
6. 手工验证三种编辑模式、统一工具栏和状态栏模式菜单、主题菜单、列表缩进、工具栏与 `Ctrl/Cmd+Alt+7/8/9` 模式切换后的文档位置（SV 以源码区为准）及状态栏同步、SV 行号/灰点/滚动、查找匹配定位、原生 outline 入口持续隐藏、Desktop 大纲跳转，以及 WYSIWYG/IR 长表格的横向滚动保留和光标可见性。
7. 仅在所有契约测试和人工检查通过后合并升级。

若契约测试失败，优先只修改 `vditor-adapter.js`；除非 Vditor 公共 API 已改变，否则不要把版本判断散布到业务代码中。
