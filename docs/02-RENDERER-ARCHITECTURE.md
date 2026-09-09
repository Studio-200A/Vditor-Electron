# 渲染进程架构

本文档描述了已实现的 0.2.5 版渲染进程。它是一份职责地图，不能替代文件安全契约或执行追踪器。

## 启动与依赖方向

`index.html` 依次加载离线 Vditor、语言包数据、Vditor 适配器、纯函数包、`app/app-composition.js`，最后加载 esbuild 打包的 `main.js`。`main.ts` 校验这些窄化的全局对象并启动组装好的 `AppController`。`AppController` 拥有启动顺序、窗口级事件以及逆序关闭逻辑；组合层创建各个控制器，并且只注入每个域所需的 bridge 与回调。

依赖从组合根向内指向领域控制器，再指向 `core/`、`utils/`、类型与 bridge 契约。控制器不导入组合层，渲染进程业务模块也不直接持有完整的 `window.appAPI` 或 `window.fileAPI` 对象。所有 Vditor 私有 DOM 访问只存在于 `vditor-adapter.js` 中。

## 状态所有权

| 状态 | 所有者与命令 | 消费者 / 排他性 |
| --- | --- | --- |
| 打开的文档、活动 ID、工作区、设置与语言 | `state/AppStore`，通过命名命令 | 控制器读取视图；不存在公开的任意补丁操作。 |
| 规范身份、保存基线、冲突、不可用状态与监视器转换 | `documents/DocumentController` 及其保存/关闭/监视工作流 | 编辑器代码接收命名操作，从不决定文件安全性。 |
| Vditor 实例、DOM 宿主、定时器、观察器、选区与运行时代次 | `editor/EditorController` 及聚焦的编辑器控制器 | 运行时句柄从不持久化。 |
| 会话与恢复投影 | 文档快照模块以及 `RecoveryRuntimeController` | 只有带版本的、可序列化的 DTO 才能跨越持久化/IPC 边界。 |
| 工作区根修订与资源管理器 DOM 状态 | `workspace/WorkspaceController` 与 `ExplorerController` | 资源管理器通过文档边界提交文档绑定意图。 |
| 设置对话框生命周期与偏好持久化 | `settings/` 控制器 | 展示型设置使用公开的 Vditor setter；仅构造期设置会请求定向重建。 |
| 应用自有的菜单、窗口装饰、语言与主题呈现 | `ui/` 控制器 | 它们不查询 Vditor 私有 DOM。 |

## 领域布局

- `app/`：应用启动、外壳生命周期与依赖组合。
- `documents/`：标签页呈现、文档生命周期、安全保存、关闭/外部变更工作流与会话快照。
- `editor/`：Vditor 构建/运行时、工具栏、分屏视图、大纲、查找、图片与恢复运行时行为。
- `workspace/`、`settings/`、`ui/`、`export/` 与 `resource-health/`：各自的产品领域。
- `core/` 与 `utils/`：生命周期原语与纯函数辅助；`types/` 与 `src/shared/contracts/`：带类型的浏览器与可序列化边界。

## 生命周期规则

每个注册了监听器、定时器、观察器、动画帧或订阅的控制器都要暴露幂等的清理方法。编辑器重建或标签页关闭会在清理之前先使旧的运行时代次失效；迟到的回调无法改动替换后的运行时。应用初始化失败与 `beforeunload` 走同一条逆依赖清理路径。

组合层有意不做第二个所有者：它可以协调跨域的命名事务，但不得获取属于某个领域控制器的 Vditor 选择器、bridge 订阅、定时器、监视器或直接 Store 写入。
