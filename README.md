# Vditor Desktop

<img src="src/renderer/assets/vditor-desktop.svg" 
alt="Vditor桌面端" 
style="width: 128px; height: auto;" />

- Vditor Desktop 是一款基于 [Electron](https://github.com/electron/electron) 与[Vditor](https://github.com/Vanessa219/vditor) 构建的本地 Markdown 桌面编辑器。它在保留Vditor 所见即所得、即时渲染和分栏预览三种编辑体验的同时，提供多标签、工作区资源管理器、文档大纲、本地图片、自动保存、会话恢复和桌面文件关联等完整的桌面应用能力。

- 项目目前处于 **pre-alpha** 阶段，以 Linux 桌面为主要开发和验证平台，同时为 Windows 和macOS 保留了对应的配置目录、窗口外观与平台适配。

<div style="display: flex; gap: 10px; flex-wrap: wrap;">
  <img src="assets/screenshot-light.webp" alt="Vditor Desktop 浅色主题" style="flex: 1; min-width: 200px; max-width: 48%;">
  <img src="assets/screenshot-monokai-dark.webp" alt="Vditor Desktop Monokai Pro Dark 主题" style="flex: 1; min-width: 200px; max-width: 48%;">
</div>

## 目录

- [产品特色](#产品特色)
- [编辑模式](#编辑模式)
- [主题与本地化](#主题与本地化)
- [安装与运行](#安装与运行)
- [基本使用](#基本使用)
- [配置与数据目录](#配置与数据目录)
- [开发与测试](#开发与测试)
- [项目结构](#项目结构)
- [开源项目](#开源项目)
- [项目状态](#项目状态)
- [免责声明](#免责声明)
- [许可证](#许可证)

## 产品特色

### 桌面化编辑体验

- 单窗口多标签编辑，未命名文档自动编号，并保留每个标签独立的编辑状态与撤销栈。
- 支持新建、打开、保存、另存为、自动保存、HTML 导出和 PDF 导出。
- 支持 UTF-8、UTF-8 BOM 与 GB18030 文本读取，保存时统一写入 UTF-8。
- 可从文件管理器的“打开方式”启动应用；冷启动和二次唤醒均会打开指定 Markdown 文档。
- 支持拖入 Markdown 文件、外部文件变更监控和最近文件记录。

### 工作区与导航

- 可将目录作为工作区打开，并在资源管理器中浏览 Markdown 文件结构。
- 支持目录展开与收起、自然排序、扩展名过滤、新建、重命名、移到回收站及系统文件管理器定位。
- 资源管理器仅用于展示和点选文档，不会因拖动侧边栏边缘而误触发文件移动。
- 文档大纲读取 H1–H6 标题，可在三种编辑模式中跳转到对应位置。
- 侧边栏宽度、显示状态、已打开标签和工作区可按设置恢复。

### Markdown 与媒体资源

- 文档中的相对路径图片通过受控本地协议加载，在线图片可在三种模式中预览。
- 粘贴或上传图片时，可按设置写入相对目录，并对 PNG、JPEG、WebP 执行尺寸和质量处理。
- 支持数学公式、流程图、图表、代码高亮、脚注、上下标、目录等 Vditor Markdown 能力。
- 可按应用明暗模式分别记忆内容主题和代码块主题。
- 可选显示 Vditor 的多平台排版预览工具栏；关闭时默认采用 Desktop 排版。

### 桌面窗口与界面

- 自定义标题栏、菜单栏、统一工具栏、标签栏、侧边栏和横跨窗口底部的状态栏。
- Linux 使用 Electron 原生 CSD/Wayland 窗口缩放命中区域；Windows 使用自绘窗口按钮；macOS
  使用原生红绿灯按钮布局。
- 窗口大小、最大化状态以及设置窗口尺寸均可持久化。
- 状态栏显示路径、编辑模式、词数、字符数、行数、编码、换行符、版本和主题切换控件。

## 编辑模式

| 模式       | 说明                                                                 |
| ---------- | -------------------------------------------------------------------- |
| 所见即所得 | 直接编辑最终排版结果，适合以阅读和排版为中心的写作。                 |
| 即时渲染   | 在光标附近保留 Markdown 标记，其余内容实时渲染，兼顾语法与视觉结果。 |
| 分栏预览   | 左侧编辑 Markdown 源码，右侧显示预览；分隔线比例可拖动并持久化。     |

编辑模式可以从统一工具栏或“视图 → 编辑模式”菜单切换。分栏源码区支持真实 Markdown 行号、
自动缩进、可配置 Tab 空格数、空白字符灰点显示和自动隐藏滚动条。

## 主题与本地化

内置以下应用主题：

- Light
- Dark
- Monokai Pro Dark（包含独立的 H1–H6 标题配色）

状态栏主题开关会记住用户上一次使用的深色主题。内容主题和代码块主题会随明暗模式联动，同时
分别保留用户在浅色与深色模式下最后选择的代码主题。

应用级本地化当前包含：

- English（`en_US`）
- 简体中文（`zh_Hans`）
- 繁體中文（`zh_Hant`）
- 跟随系统

## 安装与运行

### 当前平台状态

- Linux：主要开发和验证平台，可生成 Portable 与 AppImage。
- Windows：已包含配置目录和窗口界面适配，尚未完成正式安装包实机验收。
- macOS：已包含配置目录和原生红绿灯按钮适配，尚未完成正式 App 构建实机验收。

项目尚处于 pre-alpha 阶段，目前建议从源码运行，或自行构建 Linux 便携产物。

### 从源码运行

需要 Node.js 22 或兼容版本及 npm：

```bash
git clone https://github.com/Studio-200A/Vditor-Electron.git
cd Vditor-Electron
npm ci
npm start
```

`npm start` 会先编译主进程并复制离线资源，然后启动 Electron。运行时不依赖 Vditor CDN。

### Linux unpacked

```bash
npm run pack
./release/linux-unpacked/vditor-desktop
```

### Linux Portable 与 AppImage

```bash
npm run release:linux
```

生成：

```text
release/vditor-desktop-x86_64-<版本号>-portable.tar.gz
release/vditor-desktop-x86_64-<版本号>-portable.AppImage
```

也可以分别构建：

```bash
npm run release:linux:portable
npm run release:linux:appimage
```

Portable 压缩包中的 `vditor-desktop.desktop` 使用 `/path/to/vditor-desktop` 作为安装位置占位符。
请将其替换为实际解压路径，再安装到桌面环境的应用程序目录。desktop entry 已关联常见 Markdown
扩展名；AppImage 添加可执行权限后即可运行。

## 基本使用

### 常用操作

| 操作       | 快捷键                 |
| ---------- | ---------------------- |
| 新建文件   | `Ctrl/Cmd + N`         |
| 打开文件   | `Ctrl/Cmd + O`         |
| 保存       | `Ctrl/Cmd + S`         |
| 另存为     | `Ctrl/Cmd + Shift + S` |
| 关闭标签   | `Ctrl/Cmd + W`         |
| 切换侧边栏 | `Ctrl/Cmd + B`         |
| 打开设置   | `Ctrl/Cmd + ,`         |
| 切换全屏   | `F11`                  |

### 工作区

- 通过“文件 → 打开文件夹”选择工作目录。若侧边栏处于隐藏状态，打开成功后会自动显示资源管理器。

- 点击 Markdown 文件即可在新标签中打开；点击目录左侧箭头可展开或收起目录。

### 设置

- 设置按外观、字体、编辑器、预览、文件与会话、关于分类。修改会实时保存；可以恢复当前页面默认值，也可以在“关于”页面底部恢复全部默认设置。

## 配置与数据目录

- 配置文件与 Chromium 用户数据相互分离：

| 平台    | 配置文件                                                                                  | Chromium 用户数据                                                                |
| ------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Linux   | `${XDG_CONFIG_HOME:-~/.config}/vditor-desktop/config.toml`                                | `${XDG_DATA_HOME:-~/.local/share}/vditor-desktop/chromium/`                      |
| Windows | `%APPDATA%\vditor-desktop\config.toml`                                                    | `%LOCALAPPDATA%\vditor-desktop\chromium\`                                        |
| macOS   | `~/Library/Application Support/com.github.studio-200a.vditor-electron/Config/config.toml` | `~/Library/Application Support/com.github.studio-200a.vditor-electron/Chromium/` |

- `config.toml` 按应用、外观、字体、编辑器、预览、文件、工作区、窗口和会话分类。应用仍在 pre-alpha阶段，配置结构以当前版本为准，不承诺旧版本配置迁移兼容。

## 开发与测试

常用命令：

| 命令                | 用途                                                  |
| ------------------- | ----------------------------------------------------- |
| `npm run dev`       | 构建资源并启动开发版本                                |
| `npm run format`    | 使用 Prettier 格式化项目                              |
| `npm run lint`      | 执行 ESLint                                           |
| `npm run typecheck` | 执行 TypeScript 类型检查                              |
| `npm test`          | 运行 Vitest 单元测试                                  |
| `npm run test:e2e`  | 构建并运行 Playwright Electron 测试                   |
| `npm run check`     | 执行格式、Lint、类型、Vditor 版本、单元测试和构建检查 |
| `npm run check:all` | 在 `check` 基础上运行全部 Electron 端到端测试         |

- Vditor 被固定为精确版本。升级前请阅读 [Vditor 升级说明](docs/VDITOR-UPGRADE.md)，检查私有 DOM选择器、适配层契约及真实 Electron 回归测试。

## 项目结构

```text
Vditor-Electron/
├── assets/                 README 截图
├── docs/                   Vditor 升级与维护文档
├── resources/linux/        Portable、AppImage 与 desktop entry 资源
├── scripts/                离线资源复制、版本检查和 Linux 发行脚本
├── src/main/               Electron 主进程、协议、文件与设置服务
├── src/renderer/           应用界面、Locale、主题与 Vditor 适配层
├── tests/unit/             Vitest 单元及契约测试
├── tests/e2e/              Playwright Electron 端到端测试
├── LICENSE                 项目许可证
└── package.json            依赖、检查、构建和发行入口
```

## 开源项目

- Vditor Desktop 由多个开源项目共同支撑。下列清单覆盖项目直接使用的运行时、Vditor 随包渲染组件以及开发与质量工具；各项目的版权与许可证归原作者所有。npm 的完整依赖解析记录见`package-lock.json`。

### 核心运行时与直接依赖

| 项目                                                           | 用途                              | 许可证          |
| -------------------------------------------------------------- | --------------------------------- | --------------- |
| [Electron](https://github.com/electron/electron)               | 跨平台桌面运行时                  | MIT             |
| [Chromium](https://github.com/chromium/chromium)               | Electron 内置网页渲染引擎         | BSD-3-Clause 等 |
| [Node.js](https://github.com/nodejs/node)                      | Electron 主进程 JavaScript 运行时 | MIT 等          |
| [Vditor](https://github.com/Vanessa219/vditor)                 | Markdown 编辑器与渲染核心         | MIT             |
| [chokidar](https://github.com/paulmillr/chokidar)              | 工作区与文档文件变更监控          | MIT             |
| [@iarna/toml](https://github.com/iarna/iarna-toml)             | TOML 配置读写                     | ISC             |
| [diff-match-patch](https://github.com/JackuB/diff-match-patch) | Vditor 使用的文本差异算法         | Apache-2.0      |

<details>
<summary>Vditor 随包 Markdown 渲染组件</summary>

| 项目                                                                                           | 用途                  |
| ---------------------------------------------------------------------------------------------- | --------------------- |
| [abcjs](https://github.com/paulrosen/abcjs)                                                    | ABC 乐谱渲染          |
| [Apache ECharts](https://github.com/apache/echarts)                                            | 图表渲染              |
| [flowchart.js](https://github.com/adrai/flowchart.js)                                          | 流程图渲染            |
| [Viz.js](https://github.com/mdaines/viz-js) / [Graphviz](https://gitlab.com/graphviz/graphviz) | Graphviz 图形渲染     |
| [highlight.js](https://github.com/highlightjs/highlight.js)                                    | 代码语法高亮          |
| [KaTeX](https://github.com/KaTeX/KaTeX)                                                        | 数学公式渲染          |
| [Lute](https://github.com/88250/lute)                                                          | Markdown 解析与格式化 |
| [markmap](https://github.com/markmap/markmap)                                                  | Markdown 思维导图     |
| [MathJax](https://github.com/mathjax/MathJax)                                                  | 数学公式渲染          |
| [Mermaid](https://github.com/mermaid-js/mermaid)                                               | 图表与流程图渲染      |
| [plantuml-encoder](https://github.com/markushedvall/plantuml-encoder)                          | PlantUML 文本编码     |
| [SmilesDrawer](https://github.com/reymond-group/smilesDrawer)                                  | SMILES 化学结构渲染   |
| [WaveDrom](https://github.com/wavedrom/wavedrom)                                               | 数字时序图渲染        |
| [Ant Design Icons](https://github.com/ant-design/ant-design-icons)                             | Vditor 工具栏图标集   |
| [Material Design Icons](https://github.com/google/material-design-icons)                       | Vditor 工具栏图标集   |

</details>

<details>
<summary>开发、测试与构建工具</summary>

| 项目                                                                                | 用途                           | 许可证     |
| ----------------------------------------------------------------------------------- | ------------------------------ | ---------- |
| [TypeScript](https://github.com/microsoft/TypeScript)                               | 主进程类型系统与编译           | Apache-2.0 |
| [ESLint](https://github.com/eslint/eslint)                                          | JavaScript/TypeScript 静态检查 | MIT        |
| [typescript-eslint](https://github.com/typescript-eslint/typescript-eslint)         | ESLint TypeScript 支持         | MIT        |
| [globals](https://github.com/sindresorhus/globals)                                  | ESLint 全局变量定义            | MIT        |
| [DefinitelyTyped / @types/node](https://github.com/DefinitelyTyped/DefinitelyTyped) | Node.js 类型定义               | MIT        |
| [Prettier](https://github.com/prettier/prettier)                                    | 代码与文档格式化               | MIT        |
| [Vitest](https://github.com/vitest-dev/vitest)                                      | 单元测试与契约测试             | MIT        |
| [jsdom](https://github.com/jsdom/jsdom)                                             | Renderer DOM 单元测试环境      | MIT        |
| [Playwright](https://github.com/microsoft/playwright)                               | Electron 端到端测试            | Apache-2.0 |
| [electron-builder](https://github.com/electron-userland/electron-builder)           | 桌面应用打包                   | MIT        |

</details>

## 项目状态

- 当前版本为 `0.1.0`，处于 pre-alpha 阶段。编辑、文件读写、工作区、主题、设置、会话恢复和 Linux便携打包已形成可测试闭环，但尚未进行正式发行所需的多发行版验收、代码签名、自动更新、安全审计和跨平台安装包验证。

- 欢迎通过 [GitHub Issues](https://github.com/Studio-200A/Vditor-Electron/issues) 报告可复现问题。提交问题时请附带操作系统、桌面环境、显示协议（Wayland/X11）、应用版本和复现步骤。

## 免责声明

- 本项目目前为 pre-alpha 软件，可能存在数据丢失、格式变化、崩溃或兼容性问题；请勿将其作为重要文档的唯一存储位置，并在使用前自行备份。
- 本项目按“原样”提供，不对适销性、特定用途适用性、无错误运行或数据完整性作任何保证。
- Vditor Desktop 是独立的社区项目，不代表 Vditor、Electron 或其他开源项目的官方产品，也不获得这些项目作者的担保。
- 用户应自行确认所处理文档、图片、字体及导出内容的版权与使用权限。

## 许可证

- Vditor Desktop 以 [MIT License](LICENSE) 发布。

- 项目依赖和随包资源可能采用 MIT、Apache-2.0、ISC、BSD 及其他兼容许可证；它们不因本项目采用MIT License 而改变各自的版权归属和许可条件。分发构建产物前，请同时遵守 Electron、Chromium、Vditor 及所有第三方组件的许可证与署名要求。
