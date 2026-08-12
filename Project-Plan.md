# Vditor Desktop 项目计划

> 文档状态：与当前代码同步
>
> 项目阶段：pre-alpha
>
> 当前版本：0.1.0
>
> 目标平台：Linux 桌面

## 1. 项目定位

Vditor Desktop 是一个基于 Electron 和 Vditor 的离线 Markdown 桌面编辑器。当前目标是在保留 Vditor 三种编辑模式的基础上，提供可靠的桌面文件操作、多标签、工作区、设置、会话恢复和本地资源访问能力。

项目采用单窗口、多标签架构。pre-alpha 阶段优先保证编辑、保存、恢复和桌面交互的正确性；设置结构只有当前代码定义的一套标准，不承担历史版本迁移。

## 2. 当前技术栈

| 层级       | 技术                          | 用途                                   |
| ---------- | ----------------------------- | -------------------------------------- |
| 桌面运行时 | Electron 42                   | 窗口、对话框、菜单、IPC、PDF 输出      |
| 编辑器     | Vditor 3.11.3                 | WYSIWYG、IR、SV 编辑及 Markdown 渲染   |
| 主进程     | TypeScript                    | 文件服务、设置服务、协议、窗口生命周期 |
| 渲染层     | Vanilla JavaScript、HTML、CSS | 应用 Shell、标签、侧边栏、设置、状态栏 |
| 文件监控   | chokidar 4                    | 工作区和已打开文件的外部变更监听       |
| 单元测试   | Vitest、jsdom                 | 设置、文件服务和渲染 Shell 检查        |
| UI 回归    | Playwright Electron           | 启动真实 Electron 窗口验证关键流程     |
| 质量工具   | ESLint、Prettier、TypeScript  | 静态检查和格式统一                     |
| 打包       | electron-builder              | Linux unpacked、AppImage、deb、rpm     |

## 3. 架构现状

```text
Electron main process
├── BrowserWindow 与生命周期
├── 原生文件/目录对话框
├── FileManagerService
├── SettingsStore
├── chokidar workspace watcher
├── app:// 与 local-file:// 协议
├── HTML/PDF 导出
└── IPC handlers
        │
        ▼
Preload contextBridge
├── window.fileAPI
└── window.appAPI
        │
        ▼
Renderer
├── 自定义标题栏与应用菜单
├── 统一工具栏
├── 资源管理器/大纲侧边栏
├── 多标签与空状态
├── 每标签一个懒加载 Vditor 实例
├── 设置窗口
└── 状态栏
```

### 3.1 进程边界

- Renderer 不启用 Node.js 集成，通过 preload 白名单 API 访问桌面能力。
- 主进程负责文件系统写入、原生对话框、窗口控制和外部链接。
- `app://` 提供 renderer 与 Vditor 静态资源，运行时不依赖 CDN。
- `local-file://` 用于解析 Markdown 文档中的相对路径图片。
- 设置保存在 `~/.vditor-desktop/settings.json`，使用临时文件和原子替换写入。

### 3.2 主要源码职责

| 文件                                  | 职责                                         |
| ------------------------------------- | -------------------------------------------- |
| `src/main/index.ts`                   | Electron 启动、窗口、IPC、对话框、监控、导出 |
| `src/main/preload.ts`                 | 桥接 `fileAPI` 和 `appAPI`                   |
| `src/main/protocol.ts`                | 离线静态资源和本地文档资源协议               |
| `src/main/menu.ts`                    | 原生应用菜单                                 |
| `src/main/services/app-state.ts`      | 当前唯一设置类型、会话类型和默认值           |
| `src/main/services/settings-store.ts` | 设置加载、白名单合并、原子保存和重置         |
| `src/main/services/file-manager.ts`   | 编码、目录、创建、重命名、移动和二进制写入   |
| `src/renderer/index.html`             | 应用 Shell 与设置页面结构                    |
| `src/renderer/app.js`                 | Renderer 状态、Vditor 生命周期和交互         |
| `src/renderer/locales.js`             | `en_US`、`zh_CN` 应用级文案                  |
| `src/renderer/styles/app.css`         | Shell、Vditor 集成、主题与布局样式           |

## 4. 已完成模块

### 4.1 桌面窗口与菜单

- Linux/Windows 使用自定义标题栏，包含 File、Edit、View、Help 菜单和窗口控制。
- 菜单支持悬停切换，Layout 子菜单会在指针离开后关闭。
- F11 切换 Electron 全屏，全屏时隐藏自定义标题栏。
- 全屏状态按 Alt 临时显示标题栏菜单。
- 标题栏菜单文字跟随 UI 缩放。
- 窗口尺寸、位置和最大化状态持久化。
- 关闭窗口前统一检查未保存标签。

### 4.2 统一工具栏

- 侧边栏、新建、打开、保存、设置使用左对齐图标按钮。
- 当前标签的 Vditor 工具栏挂载到同一工具栏行。
- 三种编辑模式共享一致的工具栏布局。
- Vditor tooltip、下拉菜单背景和层级已适配应用 Shell。
- 代码块主题和内容主题选择会写入应用设置。

### 4.3 标签与文档生命周期

- 新文件按 `Untitled 1`、`Untitled 2` 递增命名，最多 20 个标签。
- 标签支持切换、关闭和鼠标中键关闭。
- 未保存标签关闭前确认；应用退出前汇总确认。
- 无标签时显示 `No opened tabs`，提供 New File 和 Open File。
- 每个标签保留独立 Vditor 实例和撤销栈，非活动标签按需隐藏。
- 修改状态同步到标签、窗口标题和保存流程。

### 4.4 文件读写

- 支持打开多个 Markdown 文件、新建、保存、另存为和自动保存。
- 识别 UTF-8、UTF-8 BOM；无效 UTF-8 回退到 GB18030。
- 保存统一写为 UTF-8，同时保留文档 LF/CRLF 状态。
- 支持拖入 Markdown 文件打开。
- 外部文件变更时，未修改标签自动重载；有本地修改时提示冲突。
- 支持 HTML 和 PDF 导出。

### 4.5 工作区与资源管理器

- 打开目录作为工作区，并用 chokidar 监听变更。
- 头部显示工作区名称、文件夹图标和刷新按钮。
- 目录优先、自然排序，仅显示设置允许的 Markdown 扩展名。
- 支持展开目录、打开文件、拖动项目到目录。
- 右键菜单支持新建、重命名、移到回收站和文件管理器定位。
- 文件与文件夹使用内置 SVG 图标。
- 资源管理器与 Markdown 大纲共用可调整宽度的侧边栏。

### 4.6 编辑模式

- 支持 WYSIWYG、IR、SV 三种模式，并持久化当前模式。
- 修改其他设置时保持各标签当前模式。
- WYSIWYG 和 IR 支持 40%–100% 的实际文字区域宽度。
- SV 标题保留 H1–H6 视觉字号。
- SV 行号按真实 Markdown 行计算，软换行不增加行号，并与标题对齐。
- SV 编辑/预览分割线可拖动，范围 20%–80%，在 50:50 附近吸附。
- SV 支持按 H1–H6 折叠章节，只隐藏目标范围，折叠标题变灰。
- SV 可用灰点显示空格。
- Tab 可配置为制表符或 2/4/6/8 个空格。
- 支持 Vditor 列表缩进和源码自动缩进处理。

### 4.7 图片与本地资源

- 粘贴或上传图片写入相对文档的配置目录。
- PNG、JPEG、WebP 可按最大宽度和质量压缩。
- Markdown 相对路径图片通过 `local-file://` 预览。
- 文档另存到新目录后重建编辑器以更新资源基准路径。

### 4.8 大纲与状态栏

- 从 Markdown H1–H6 构建大纲，显示层级并可跳转。
- 状态栏左侧显示已保存文件绝对路径，未命名文件留空。
- 右侧显示模式、词数、字符数、行数、编码和 LF/CRLF。
- 状态栏提供设置、浅色/深色切换和版本号。

### 4.9 设置系统

- 分类：Appearance、Fonts、Editor、Preview、Files & Session、Advanced。
- 设置窗口可拖动，修改后实时保存和生效。
- 数字输入只在完整且有效时提交。
- Save Settings 保存全部设置并关闭。
- Reset This Page 仅恢复当前分类默认值。
- Advanced 提供全部设置恢复和运行时版本信息。
- 底部用 `~` 显示配置路径，并可打开配置目录。
- Locale 当前包含 `en_US` 和 `zh_CN`，可跟随系统。
- 标签恢复和工作区恢复是两个独立设置。
- 配置加载严格以当前默认结构为白名单，未知字段不会进入状态。

## 5. 设置规范

`src/main/services/app-state.ts` 是设置结构的唯一来源。当前设置分组如下：

- 会话：`restoreTabs`、`restoreWorkspace`、`session`。
- 外观：系统主题、应用主题、内容主题、代码主题、图标集、Locale。
- 字体与缩放：UI、源码、渲染文字、代码字体及各区域缩放。
- 编辑器：默认模式、打字机、Tab、空格显示、自动缩进、RTL、换行、文字宽度。
- 文件：自动保存、图片目录/压缩、最近文件和工作区、可见扩展名。
- 预览与 Markdown：延迟、最大宽度、数学引擎和语法开关。
- 布局：侧边栏宽度/可见性、工具栏可见性、SV 分割比例。
- 窗口：位置、尺寸和最大化状态。

pre-alpha 阶段不保留旧字段别名或迁移分支。修改设置结构时必须同步更新：

1. `AppSettings` 和 `DEFAULT_SETTINGS`。
2. `index.html` 的用户设置控件。
3. `app.js` 的读取与生效逻辑。
4. 两种 Locale。
5. 单元测试与 Electron 回归测试。

## 6. 构建与质量流程

### 6.1 常用命令

```bash
npm install
npm run dev
npm run format
npm run check
npm run test:e2e
npm run check:all
npm run pack
npm run dist:linux
```

### 6.2 构建流程

1. TypeScript 编译主进程到 `dist/main`。
2. `scripts/copy-vditor-assets.js` 复制 Vditor 动态资源到 `static`。
3. 同一脚本复制 renderer 文件到 `dist/renderer`。
4. Electron 从 `dist/main/index.js` 启动，加载 `app://app/index.html`。
5. electron-builder 使用 `dist`、`static` 和 `package.json` 生成 Linux 产物。

### 6.3 自动化覆盖

- 文件服务：编码、排序、创建、重命名、移动和二进制写入。
- 设置服务：默认值、部分合并、未知字段过滤、原子保存、重置和克隆隔离。
- Renderer Shell：菜单、空状态、状态栏、设置结构、工作区头部和编辑器控件。
- Electron：标签、菜单、SV 行号/折叠/拖动、全屏、工作区、会话、设置、段落宽度、主题、状态栏和本地图片。

提交前最低要求是 `npm run check`。涉及交互、窗口或 Vditor DOM 的修改还必须运行 `npm run test:e2e`。

## 7. 当前已知问题

1. F11 全屏后，Alt 目前只负责显示标题栏；目标行为是连续按 Alt 在显示/隐藏之间切换。
2. SV 点击“编辑 & 预览”隐藏预览后，源码编辑区没有占满剩余区域。
3. SV 切换为仅预览时，预览可以占满，但源码行号栏未隐藏且显示错乱。

这些问题优先于新增功能，应在下一轮修复并加入 Electron 回归测试。

## 8. 后续路线

### P0：完成 pre-alpha 编辑闭环

- 修复第 7 节三个 SV/全屏布局问题。
- 补充异常保存、外部删除、目录重命名等边界测试。
- 收紧本地资源协议授权范围，避免 renderer 任意读取本地文件。
- 评估启用 Electron sandbox，并加强 preload 参数验证。

### P1：稳定性与可维护性

- 将 renderer `app.js` 按标签、资源管理器、设置、Vditor 集成拆分模块。
- 为 Renderer 状态和 IPC payload 增加共享类型。
- 为设置结构增加运行时校验。
- 增加权限错误、无效路径和大文件场景覆盖。
- 明确未命名文档的会话持久化策略。

### P2：发行准备

- 完成应用图标、desktop entry 和包元数据。
- 在目标 Linux 发行版验证 AppImage、deb、rpm。
- 建立安装、检查、Electron 回归和打包 CI。
- 明确版本号、变更日志、签名和发布流程。
- 完成安全审查、许可证清单和离线资源审计。

## 9. 非当前范围

- 云同步、协作编辑和账户系统。
- Git 图形界面或版本历史。
- 插件市场和扩展 API。
- 设置导入/导出和快捷键可视化编辑器。
- 自动更新与签名发布。
- Windows/macOS 安装包的正式验证。

## 10. 完成定义

pre-alpha 阶段的一项修改必须同时满足：

- 行为与当前产品要求一致。
- 不引入第二套设置字段或隐式兼容标准。
- 相关 Locale 文案完整。
- 格式、Lint、TypeScript、单元测试和构建通过。
- UI 关键路径有 Electron 回归或明确手工验证。
- `Project-Plan.md`、README 与实际实现没有冲突。
