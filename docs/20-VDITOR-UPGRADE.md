# Vditor 升级流程

Vditor Desktop 不修改 `node_modules/vditor` 的源码，但工具栏合并、SV 行号与空白字符、列表缩进、查找定位和大纲跳转依赖 Vditor 的内部 DOM。升级必须作为显式维护任务进行，不能随普通依赖更新自动合入。

## 兼容边界

- 公开 API 和初始化选项位于 `src/renderer/app.js`。
- JavaScript 使用的非公开 DOM 选择器和结构判断集中在 `src/renderer/vditor-adapter.js`。
- Vditor 外观覆盖仍集中在 `src/renderer/styles/app.css` 的 Vditor integration 区段，它是升级时的第二检查面。
- `tests/unit/vditor-adapter.test.ts` 验证适配层自身。
- Electron E2E 中的 `Vditor DOM integration contract` 验证真实 Vditor 构建产物。

业务代码不得新增 Vditor 内部选择器；确有需要时，先加入适配层和契约测试。

## 升级步骤

1. 新建单独升级分支，阅读目标版本变更记录。
2. 使用精确版本安装：`npm install --save-exact vditor@<version>`。
3. 同步 `src/main/index.ts` 中关于页版本号。
4. 检查目标包 `dist/index.css`、工具栏、SV、IR、WYSIWYG 和 preview DOM 变化。
5. 先运行 `npm run check:vditor`，再运行 `npm run check:all`。
6. 手工验证三种编辑模式、统一工具栏和状态栏模式菜单、主题菜单、列表缩进、模式切换后的文档位置（SV 以源码区为准）、SV 行号/灰点/滚动、查找匹配定位和大纲跳转。
7. 仅在所有契约测试和人工检查通过后合并升级。

若契约测试失败，优先只修改 `vditor-adapter.js`；除非 Vditor 公共 API 已改变，否则不要把版本判断散布到业务代码中。
