# Vditor Desktop

中文 · [English](README.md)

<p align="center">
  <img src="src/renderer/assets/vditor-desktop.svg" alt="Vditor Desktop" width="128" />
</p>

<p align="center">
  一款安静、以本地文件为核心的 Markdown 编辑器，让你在专注的桌面工作区中使用 Vditor 的完整能力。
</p>

<p align="center">
  <a href="https://github.com/Studio-200A/Vditor-Electron/releases"><img src="https://img.shields.io/badge/version-0.1.5-blue" alt="Version 0.1.5" /></a>
  <a href="https://github.com/Studio-200A/Vditor-Electron/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" /></a>
  <a href="https://github.com/Studio-200A/Vditor-Electron"><img src="https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20macOS-lightgrey" alt="Linux, Windows and macOS" /></a>
  <a href="https://github.com/prettier/prettier"><img src="https://img.shields.io/badge/code_style-prettier-ff69b4.svg" alt="code style: prettier" /></a>

</p>

Vditor Desktop 是一款基于 [Electron](https://github.com/electron/electron) 和 [Vditor](https://github.com/Vanessa219/vditor) 构建的本地 Markdown 写作软件。你的文档始终是电脑上的普通 Markdown 文件；同时，软件补充了桌面编辑器应有的完整体验：多标签、工作区、资源管理器、文档大纲、主题、本地图片、会话恢复和桌面文件关联。

![Vditor Desktop 浅色主题](assets/screenshot-light.webp)

![Vditor Desktop Monokai Pro Dark 主题](assets/screenshot-monokai-dark.webp)

## 目录

- [为什么选择 Vditor Desktop](#为什么选择 Vditor Desktop)
- [三种编辑模式](#三种编辑模式)
- [不打扰写作的工作区](#不打扰写作的工作区)
- [主题与语言](#主题与语言)
- [安装与运行](#安装与运行)
- [常用快捷键](#常用快捷键)
- [配置与数据目录](#配置与数据目录)
- [构建与测试](#构建与测试)
- [参与贡献](#参与贡献)
- [开源项目](#开源项目)
- [免责声明](#免责声明)
- [许可证](#许可证)

## 为什么选择 Vditor Desktop

- **Markdown 不被锁定。** 直接打开和保存普通 `.md` 文件，不需要账号、云同步、专有文档格式或在线服务。
- **三种写作方式。** 在所见即所得、即时渲染和分栏预览之间切换，不离开当前文档。
- **完整的桌面文件体验。** 支持从命令行或文件管理器打开文件，以目录作为工作区，并在会话之间恢复标签页和窗口状态。
- **面向工作区的文件操作。** 支持创建编号的未命名文档、在文件树中直接新建和重命名文件、从资源管理器右键菜单打开工作区，以及将文件移入回收站。
- **编辑区右键菜单。** 在任意编辑模式中右键可使用剪贴板、删除和上下文选择；渲染模式下的表格单元格还提供行列操作。
- **专注而克制的界面。** 紧凑的工作区顶部栏将菜单、文件操作、标签页和窗口控制汇集在一起，编辑工具栏仅在需要时显示，避免界面变成复杂的仪表盘。
- **丰富的 Markdown 能力。** 保留 Vditor 对公式、图表、流程图、脚注、代码高亮、目录和媒体预览等内容的支持。
- **本地优先。** 配置和 Chromium 数据存放在各平台对应的本地目录，软件不会上传你的文档。

## 三种编辑模式


| 模式           | 适合场景                                                           |
| -------------- | ------------------------------------------------------------------ |
| **所见即所得** | 直接按照最终排版效果写作和编辑。                                   |
| **即时渲染**   | 光标附近保留 Markdown 标记，其余内容实时渲染，兼顾语法和视觉效果。 |
| **分栏预览**   | 左侧编辑 Markdown 源码，右侧查看渲染后的文档。                     |

可以通过统一工具栏或“视图 → 编辑模式”切换模式。分栏预览提供源码行号、可配置 Tab 空格数、可选的空白字符灰点、可拖动的分隔线以及自动隐藏的预览滚动条。

## 不打扰写作的工作区

- 将目录作为工作区打开，在资源管理器中浏览其中的 Markdown 文件。
- 展开或收起目录、按扩展名过滤、新建和重命名文件、将项目移到回收站，或在系统文件管理器中定位。
- 读取 H1–H6 文档大纲，并在三种编辑模式中跳转到对应标题。
- 在多个编号的未命名标签页中同时编辑文档，每个标签页拥有独立的撤销历史和修改状态。
- 可拖动标签页，按适合自己的顺序排列文档。
- 收起资源管理器可扩大编辑空间；新建、打开、保存按钮会随之收起，但菜单和快捷键始终可用。
- 支持保存、另存为、导出 HTML 或 PDF，并恢复上次工作区和窗口状态。
- 使用 `Ctrl/Cmd + F` 打开紧凑面板，在当前文档中查找和替换文本。
- 监控当前工作区中的文件变化；没有本地修改的文档会自动重载，有本地修改的文档会显示持久冲突横幅，并在处理前暂停自动保存。
- 粘贴或上传图片到可配置的相对资源目录；相对路径图片和在线图片可以在三种模式中预览。

当前外部文件监控覆盖活动工作区中的文件，以及工作区中出现预期保存路径的未命名文档。工作区外文件、文件删除后的恢复、目录移动、原子保存和跨应用重启的冲突恢复仍属于后续可靠性工作；重要文档请保留备份。

## 主题与语言

内置应用主题：

- 浅色
- 深色
- Monokai Pro Dark，包含独立的 H1–H6 标题配色

主题切换会记住用户上一次使用的深色主题。内容主题和代码块预览主题会跟随应用的浅色/深色环境，同时分别保留用户在两种环境下最后选择的主题。需要时可以启用多平台排版预览。

界面目前支持 English（`en_US`）、简体中文（`zh_Hans`）、繁體中文（`zh_Hant`）以及跟随系统语言。

## 安装与运行

### 从源码运行

需要 Node.js 22 或兼容版本及 npm：

```bash
git clone https://github.com/Studio-200A/Vditor-Electron.git
cd Vditor-Electron
npm ci
npm start
```

构建过程会将 Vditor 的资源复制到本地，运行时不依赖 Vditor CDN。

### Linux 构建

项目可以生成 Linux unpacked 目录、Portable 压缩包和 AppImage：

```bash
npm run pack                 # release/linux-unpacked
npm run release:linux       # 全部 Linux 产物
```

发行命令会生成：

```text
release/vditor-desktop-x86_64-<版本号>-portable.tar.gz
release/vditor-desktop-x86_64-<版本号>-portable.AppImage
```

Portable 压缩包中的 desktop 文件使用 `/path/to/vditor-desktop` 作为安装路径占位符。安装到桌面环境前，请将其替换为实际解压路径。AppImage 添加可执行权限后即可运行。

目前 Linux 是主要开发和验证平台；项目已经包含 Windows 和 macOS 的窗口及数据目录适配，为后续平台构建做准备。

## 常用快捷键


| 操作                           | 快捷键                 |
| ------------------------------ | ---------------------- |
| 新建文件                       | `Ctrl/Cmd + N`         |
| 打开文件                       | `Ctrl/Cmd + O`         |
| 保存                           | `Ctrl/Cmd + S`         |
| 另存为                         | `Ctrl/Cmd + Shift + S` |
| 查找和替换                     | `Ctrl/Cmd + F`         |
| 选择当前上下文 / 全文          | `Ctrl/Cmd + A`         |
| 关闭标签页                     | `Ctrl/Cmd + W`         |
| 切换资源管理器                 | `Ctrl/Cmd + B`         |
| 打开设置                       | `Ctrl/Cmd + ,`         |
| 切换 Chrome DevTools（启用后） | `Ctrl/Cmd + Shift + I` |
| 切换全屏                       | `F11`                  |

## 配置与数据目录

应用配置和 Chromium 用户数据相互分离：


| 平台    | 配置文件                                                                                  | Chromium 数据                                                                    |
| ------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Linux   | `${XDG_CONFIG_HOME:-~/.config}/vditor-desktop/config.toml`                                | `${XDG_DATA_HOME:-~/.local/share}/vditor-desktop/chromium/`                      |
| Windows | `%APPDATA%\\vditor-desktop\\config.toml`                                                  | `%LOCALAPPDATA%\\vditor-desktop\\chromium\\`                                     |
| macOS   | `~/Library/Application Support/com.github.studio-200a.vditor-electron/Config/config.toml` | `~/Library/Application Support/com.github.studio-200a.vditor-electron/Chromium/` |

TOML 配置文件可直接阅读，按应用、外观、字体、编辑器、预览、文件、工作区、窗口和会话设置分类。

## 构建与测试

```bash
npm run format:check
npm run lint
npm run typecheck
npm run check:vditor
npm test
npm run check:all
```

Vditor 依赖固定为 3.11.3。升级前请先阅读 [Vditor 升级说明](docs/20-VDITOR-UPGRADE.md)，并检查适配层边界和 Electron 回归测试。

## 参与贡献

项目开发在按版本或功能建立的 `dev-*` / `feat-*` 分支进行，完成后通过 Pull Request 合并到 `main`。欢迎参与：

- 提供包含操作系统、桌面环境、显示协议、版本和复现步骤的可复现问题报告；
- 为编辑器、文件、工作区和跨平台行为提交修复与测试；
- 改进文档、翻译、可访问性和视觉细节；
- 阅读并讨论 [`docs/`](docs/README.md) 中的开发规划。

请保持项目的本地优先定位，并遵守仓库中的安全边界要求。

## 开源项目

Vditor Desktop 的实现离不开以下开源项目。各项目作者保留其版权和许可证权利，完整依赖解析记录见 [`package-lock.json`](package-lock.json)。

<details>
<summary>运行时与直接依赖</summary>


| 项目                                                           | 作用                      | 许可证          |
| -------------------------------------------------------------- | ------------------------- | --------------- |
| [Electron](https://github.com/electron/electron)               | 跨平台桌面运行时          | MIT             |
| [Chromium](https://github.com/chromium/chromium)               | Electron 的网页渲染引擎   | BSD-3-Clause 等 |
| [Node.js](https://github.com/nodejs/node)                      | 主进程运行时              | MIT 等          |
| [Vditor](https://github.com/Vanessa219/vditor)                 | Markdown 编辑器和渲染核心 | MIT             |
| [chokidar](https://github.com/paulmillr/chokidar)              | 文件变化监控              | MIT             |
| [@iarna/toml](https://github.com/iarna/iarna-toml)             | TOML 配置读写             | ISC             |
| [diff-match-patch](https://github.com/JackuB/diff-match-patch) | Vditor 使用的文本差异算法 | Apache-2.0      |

</details>

<details>
<summary>随 Vditor 提供的 Markdown 渲染组件</summary>

- [abcjs](https://github.com/paulrosen/abcjs) · [Apache ECharts](https://github.com/apache/echarts) · [flowchart.js](https://github.com/adrai/flowchart.js)
- [Viz.js](https://github.com/mdaines/viz-js) · [Graphviz](https://gitlab.com/graphviz/graphviz) · [highlight.js](https://github.com/highlightjs/highlight.js)
- [KaTeX](https://github.com/KaTeX/KaTeX) · [Lute](https://github.com/88250/lute) · [markmap](https://github.com/markmap/markmap)
- [MathJax](https://github.com/mathjax/MathJax) · [Mermaid](https://github.com/mermaid-js/mermaid) · [plantuml-encoder](https://github.com/markushedvall/plantuml-encoder)
- [SmilesDrawer](https://github.com/reymond-group/smilesDrawer) · [WaveDrom](https://github.com/wavedrom/wavedrom) · [Ant Design Icons](https://github.com/ant-design/ant-design-icons) · [Material Design Icons](https://github.com/google/material-design-icons)

</details>

<details>
<summary>开发、测试与打包工具</summary>

- [TypeScript](https://github.com/microsoft/TypeScript) · [ESLint](https://github.com/eslint/eslint) · [typescript-eslint](https://github.com/typescript-eslint/typescript-eslint)
- [Prettier](https://github.com/prettier/prettier) · [Vitest](https://github.com/vitest-dev/vitest) · [jsdom](https://github.com/jsdom/jsdom)
- [Playwright](https://github.com/microsoft/playwright) · [electron-builder](https://github.com/electron-userland/electron-builder) · [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped)

</details>

## 免责声明

Vditor Desktop 用于本地 Markdown 编辑，软件仍在持续完善。请为重要文件保留备份，并在依赖导出内容前进行检查。作者及贡献者不对因使用本项目造成的任何文件丢失、损坏、数据错误或其他损失和责任承担责任。

## 许可证

Vditor Desktop 采用 [MIT License](LICENSE) 发布。
