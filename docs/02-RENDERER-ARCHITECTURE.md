# 渲染进程架构

本文档描述了当前已实现的渲染进程（0.2.5 架构收口，0.2.6–0.2.7 延续同一架构）。它是一份职责地图，不能替代文件安全契约或执行追踪器。

## 启动与依赖方向

`index.html` 依次加载离线 Vditor、语言包数据、Vditor 适配器、纯函数包、`app/app-composition.js`，最后加载 esbuild 打包的 `main.js`。`main.ts` 校验 `Vditor`、`VditorDesktopAdapter`、`fileAPI`、`appAPI` 这四个窄化全局对象，并启动组合层发布在 `window.__vditorDesktopApplication` 上的 `AppController` 实例；语言包与共享模块包全局对象由 `app/app-composition.js` 在加载时解引用。`AppController` 拥有启动顺序、窗口级事件以及逆序关闭逻辑；组合层创建各个控制器，并且只注入每个域所需的 bridge 与回调。

依赖从组合根向内指向领域控制器，再指向 `core/`、`utils/`、类型与 bridge 契约。控制器不导入组合层，渲染进程业务模块也不直接持有完整的 `window.appAPI` 或 `window.fileAPI` 对象。所有 Vditor 私有 DOM 访问只存在于 `vditor-adapter.js` 中。

## 状态所有权

| 状态 | 所有者与命令 | 消费者 / 排他性 |
| --- | --- | --- |
| 打开的文档、活动 ID、工作区、设置与语言 | `state/AppStore`，通过命名命令 | 控制器读取视图；不存在公开的任意补丁操作。 |
| 规范身份、保存基线、冲突、不可用状态与监视器转换 | `documents/DocumentController` 及其保存/关闭/监视工作流 | 编辑器代码接收命名操作，从不决定文件安全性。 |
| Vditor 实例、DOM 宿主、定时器、观察器、选区与运行时代次 | `editor/EditorController` 及聚焦的编辑器控制器 | 运行时句柄从不持久化。 |
| 会话与恢复投影 | 文档快照模块以及 `RecoveryRuntimeController` | 只有带版本的、可序列化的 DTO 才能跨越持久化/IPC 边界。 |
| 工作区根修订与资源管理器 DOM 状态 | `workspace/WorkspaceController` 与 `ExplorerController` | 资源管理器通过文档边界提交文档绑定意图。 |
| 设置对话框生命周期与偏好持久化 | `settings/` 控制器 | 展示型设置经公开 setter、adapter 或应用 CSS 热应用；构造期设置会重建受影响的已初始化标签，保留各标签模式、SV 布局、undo 与滚动。 |
| 应用自有的菜单、窗口装饰、语言与主题呈现 | `ui/` 控制器；主题应用由 `ui/theme-coordinator.ts` 协调，主题集合由 `ui/theme.ts` 定义 | 它们不查询 Vditor 私有 DOM；对 Vditor 的作用只经公开的 `setTheme()` 与注入的 adapter 语义回调（代码主题按钮分类、Mermaid 色调重绘）。 |

## 领域布局

- `app/`：应用启动、外壳生命周期与依赖组合。
- `documents/`：标签页呈现、文档生命周期、安全保存、关闭/外部变更工作流与会话快照。
- `editor/`：Vditor 构建/运行时与运行时协调（`editor-runtime-coordinator.ts`）、工具栏、分屏视图、大纲、查找、图片、GitHub Alerts 呈现（`github-alerts.ts`）、文档链接导航（`document-link-navigation-controller.ts`）与恢复运行时行为。
- `workspace/`、`settings/`、`ui/`、`export/` 与 `resource-health/`：各自的产品领域。
- `state/`：`AppStore`、带版本的会话/恢复快照与应用状态类型。
- `core/` 与 `utils/`：生命周期原语与纯函数辅助；`types/` 与 `src/shared/contracts/`：带类型的浏览器与可序列化边界。
- `styles/` 与 `assets/`：应用 CSS、主题样式表与图标、通知等静态资源。
- `locale/` 下的 `en_US.ts`、`zh_Hans.ts`、`zh_Hant.ts` 分别保存三语 UI 文案；`locale/index.ts` 汇总字典，经 esbuild 生成 `dist/renderer/locales.js`，由 `index.html` 在 `app/app-composition.js` 之前加载并发布 `window.VditorDesktopLocales`。`pure-functions.ts` 是共享模块包的另一入口，组合层以 `PURE.*` 消费；它还导出控制器类与选项类型，名字仅反映历史起点。

## 生命周期规则

### 文档反馈与标签栏

`documents/document-feedback.ts` 仅把文档打开、保存和重建结果映射为本地化文案及呈现方式，不决定保存交易或文件状态。`ui/NotificationsController` 拥有状态栏计时、短暂通知队列和确认对话框资源：短暂通知最新在上、每条独立 5 秒，最多 3 条活动提示，超限条目提前渐隐；transitionend 与 fallback 负责退出清理。常驻文件警示保持在通知队列上方，CSS 负责实际高度排列和统一渐显/渐隐，不新增组合层位置计算。

`documents/TabController` 拥有独立 `#tabStrip` 的滚轮、scroll listener、ResizeObserver 和活动标签滚入视野；`#addTab` 位于滚动区外。左右溢出状态驱动允许鼠标穿透的主题阴影；应用关闭时清理所有监听与观察器。`app/AppController` 在 body 捕获阶段分类文件拖入，Markdown 交给文档命令，编辑区图片留给 Vditor 上传，其他文件提前拒绝，防止被误当成图片上传。以上职责均不访问 Vditor 私有 DOM。

### 资源清理与组合边界

每个注册了监听器、定时器、观察器、动画帧或订阅的控制器都要暴露幂等的清理方法。编辑器重建或标签页关闭会在清理之前先使旧的运行时代次失效；迟到的回调无法改动替换后的运行时。应用初始化失败与 `beforeunload` 走同一条逆依赖清理路径。

组合层负责 controller 实例化、窄依赖注入、短委托与命名跨域事务。当前还保留侧栏拖拽、外层 pane 滚动条自动显隐等局部 UI 行为；这些是既有实现边界，不能据此把新增监听、定时器、观察器、Store 写入或 bridge 订阅继续放入组合层。新行为由所属域控制器拥有状态与资源，再通过窄回调接线。Vditor 私有选择器仍只能属于 adapter。是否继续提取以 [`09-DEV-NOTE.md` 的“模块化重构边界”](09-DEV-NOTE.md#模块化重构边界)的判据为准，而不是以文件体量为准。

### 代码块呈现与嵌套滚动

`editor/editor-options.ts` 通过公开的 `preview.hljs.renderMenu` 注入 adapter 的 `decorateCodeBlockMenu()`；语言识别、复制菜单结构和 CSP 兼容事件绑定均由 adapter 封装。`styles/app.css` 预留语言与复制顶栏，沿用所选代码主题的背景和纹理，语言标签通过伪元素呈现，不进入 Markdown、行号或复制正文。此路径不修改全文或另建 undo 状态。

外层 pane 自动显隐经 adapter 的 `scrollContainers()` / `innerScroller()` 获取滚动面，既有组合回调检测右侧纵向边缘和存在横向溢出时的底部边缘。表格与渲染代码块的嵌套滚动条由 CSS 独立管理，不能继承外层 pane 的透明颜色后只靠外层显隐类控制。真实 Vditor/剪贴板与滚动交互分别由 `tests/e2e/code-block-header.spec.ts` 和 `tests/e2e/scrollbars.spec.ts` 验证。
