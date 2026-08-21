# Vditor 升级流程

Vditor Desktop 不修改 `node_modules/vditor` 的源码，但工具栏合并、SV 行号与空白字符、列表缩进、查找定位和大纲跳转依赖 Vditor 的内部 DOM。升级必须作为显式维护任务进行，不能随普通依赖更新自动合入。

## 兼容边界

- 公开 API 和初始化选项位于 `src/renderer/app.js`。
- JavaScript 使用的非公开 DOM 选择器和结构判断集中在 `src/renderer/vditor-adapter.js`。
- Vditor 外观覆盖仍集中在 `src/renderer/styles/app.css` 的 Vditor integration 区段，它是升级时的第二检查面。
- `tests/unit/vditor-adapter.test.ts` 验证适配层自身。
- Electron E2E 中的 `Vditor DOM integration contract` 验证真实 Vditor 构建产物。
- Vditor 3.11.3 的模式切换仍会操作内部 `outline` 工具项；adapter 保留该项作为不可见占位，并通过应用专用 data attribute 和 CSS `display: none !important` 隐藏入口。升级时须验证三种模式切换正常，且原生 outline 控制不出现。
- 同一私有切换路径会在 SV 中隐藏并禁用 `outdent` / `indent`；adapter 为它们设置应用专用稳定占位标记，CSS 保持按钮可见且应用捕获层处理 source-selection 缩进。升级时须确认 WYSIWYG/IR → SV 没有延迟二次工具栏重排，且 SV 缩进与反缩进仍可用。
- Desktop 大纲通过 adapter 复刻 Vditor `Outline.render()` 的 content-element 选择：preview 可见时读取其 `.vditor-reset`，否则读取当前模式编辑区，再枚举直接 H1–H6。升级时须验证三种模式的 snapshot、SV 双侧目标映射与原生顺序一致。
- Desktop 编辑区底部留白通过 adapter 向 SV、IR、WYSIWYG 与 preview 写入私有 CSS 变量 `--editor-bottom`；Vditor 3.11.3 的 SV/IR/WYSIWYG 使用尾部 `::after` 消费该变量，Desktop 为 preview 提供同等尾部元素。升级时须验证三种编辑模式、SV preview 及窗口缩放后的留白高度均约为编辑器实际高度的一半，且用户的 typewriterMode 设置语义不变。
- Desktop 编辑区右键菜单通过 adapter 识别私有 WYSIWYG / IR table、保存与恢复编辑 Range，并按 Vditor 3.11.3 的表格 DOM 结构执行行列动作后重新进入其 mode-specific input / undo 路径。右键菜单不提供撤销/重做，仍使用 Vditor 工具栏和快捷键。升级时须验证三种模式的可编辑表面识别、SV preview 排除、四项表格操作、Markdown 输出、undo 与光标恢复；如上游公开表格 API，应优先评估替换该私有适配。

业务代码不得新增 Vditor 内部选择器；确有需要时，先加入适配层和契约测试。

## 升级步骤

1. 新建单独升级分支，阅读目标版本变更记录。
2. 使用精确版本安装：`npm install --save-exact vditor@<version>`。
3. 同步 `src/main/index.ts` 中关于页版本号。
4. 检查目标包 `dist/index.css`、工具栏、SV、IR、WYSIWYG 和 preview DOM 变化。
5. 先运行 `npm run check:vditor`，再运行 `npm run check:all`。
6. 手工验证三种编辑模式、统一工具栏和状态栏模式菜单、主题菜单、列表缩进、模式切换后的文档位置（SV 以源码区为准）、SV 行号/灰点/滚动、查找匹配定位、原生 outline 入口持续隐藏，以及 Desktop 大纲跳转。
7. 仅在所有契约测试和人工检查通过后合并升级。

若契约测试失败，优先只修改 `vditor-adapter.js`；除非 Vditor 公共 API 已改变，否则不要把版本判断散布到业务代码中。
