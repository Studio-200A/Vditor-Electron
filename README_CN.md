# Vditor Desktop

中文 · [English](README.md)

<p align="center">
  <img src="src/renderer/assets/app-icon/vditor-desktop.svg" alt="Vditor Desktop" width="128" />
</p>

<p align="center">
  一个为专注本地 Markdown 撰写和阅读而打造的桌面编辑器——不用开浏览器里的标签页，不搞云账号，只把 Vditor 完整的编辑能力安放在一片安静的本地工作区里。
</p>

<p align="center">
  <a href="https://github.com/Studio-200A/Vditor-Electron/releases"><img src="https://img.shields.io/badge/version-0.1.5-blue" alt="Version 0.1.5" /></a>
  <a href="https://github.com/Studio-200A/Vditor-Electron/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" /></a>
  <a href="https://github.com/Studio-200A/Vditor-Electron"><img src="https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20macOS-lightgrey" alt="Linux, Windows and macOS" /></a>
  <a href="https://github.com/prettier/prettier"><img src="https://img.shields.io/badge/code_style-prettier-ff69b4.svg" alt="code style: prettier" /></a>

</p>

Vditor Desktop 把 [Vditor](https://github.com/Vanessa219/vditor)——**最好用的 Markdown 编辑内核之一**——装进了它本该拥有的桌面外壳。没有专有格式，也没有任何锁定：你写下的内容，任何时候落在磁盘上的都是一份最普通的 `.md` 文件。在此基础上，软件补全了一款真正的桌面工具该有、而网页版编辑器给不了的部分：多标签、工作区、资源管理器、Vditor 自带大纲、主题、会话恢复和桌面文件关联。

![Vditor Desktop 浅色主题](assets/screenshot-light.webp)

![Vditor Desktop Monokai Pro Dark 主题](assets/screenshot-monokai-dark.webp)

## 目录

- [为什么选择 Vditor Desktop](#为什么选择-vditor-desktop)
- [三种编辑模式](#三种编辑模式)
- [不打扰写作的工作区](#不打扰写作的工作区)
- [尽心保护你和你的内容](#尽心保护你和你的内容)
- [主题与语言](#主题与语言)
- [安装与运行](#安装与运行)
- [常用快捷键](#常用快捷键)
- [配置与数据目录](#配置与数据目录)
- [构建与测试](#构建与测试)
- [开源项目](#开源项目)
- [免责声明](#免责声明)
- [许可证](#许可证)

## 为什么选择 Vditor Desktop

- **只属于你的本地文件：** 不需要账号，不需要云同步，也没有专有格式。写下的就是磁盘上一份普通的 `.md` 文件，随时能用任何其他编辑器打开、迁移，永远不会被任何软件绑定。
- **想怎么写就怎么写：** 想看最终排版效果就用所见即所得，想兼顾语法和视觉就用即时渲染，想左右对照就用分栏预览——写作过程中随时切换，不用中断思路。
- **真正的桌面端，不是网页套壳：** 可以从命令行或文件管理器直接打开文件，把任意目录当作项目来用，下次打开时标签页和窗口布局都还在原地。
- **文件树与编辑器天然一体，而不是买一赠一：** 不用离开文档就能新建、重命名和整理文件，也能直接在资源管理器的右键菜单里打开新工作区或把文件送进回收站。
- **看似不起眼、用起来却很顺手的小巧思：** 写作时随手右键就有剪贴板和选择操作，渲染后的表格自带行列控制，也不会再遇到菜单开着开着忘了自己收起来的情况。
- **安静，不喧宾夺主：** 一条紧凑的顶部栏装下菜单、文件操作、标签页和窗口控制，编辑工具栏只在真正需要时才出现。
- **Vditor 该有的能力一个不少：** 公式、图表、流程图、脚注、代码高亮、目录、媒体预览——尊重上游，完整呈现。
- **聚焦本地：** 配置和应用数据都存在系统对应的本地目录里，没有上传这一说，因为根本没有可以上传的地方。

## 三种编辑模式

| 模式           | 适合场景                                                           |
| -------------- | ------------------------------------------------------------------ |
| **所见即所得** | 直接按照最终排版效果写作和编辑。                                   |
| **即时渲染**   | 光标附近保留 Markdown 标记，其余内容实时渲染，兼顾语法和视觉效果。 |
| **分栏预览**   | 左侧编辑 Markdown 源码，右侧查看渲染后的文档。                     |

可以通过统一工具栏或“视图 → 编辑模式”切换模式。分栏预览提供源码行号、可配置 Tab 空格数、可选的空白字符灰点、可拖动的分隔线以及自动隐藏的预览滚动条。

## 不打扰写作的工作区

大多数时候你不是在“管理一个编辑器”，只是在写东西。Vditor Desktop 尽量让周围这些工具在你没用到之前保持安静。

- 指向一个目录，它就是你的工作区：Markdown 文件直接在资源管理器里浏览，不需要额外的导入步骤。
- 用你熟悉的方式在文件间穿梭——展开、收起、按扩展名过滤、重命名、移入回收站，或者一键定位到系统文件管理器，全程不用离开编辑器。
- 长文档也不会迷路：内置大纲完整呈现Vditor原生大纲的多种标题解析能力，且与桌面UI自然融合。
- 同时打开多份文档，每一份都有独立的撤销历史和未保存状态提示，标签页可以拖动，排成你顺手的顺序。
- 想要更大的写作空间？收起资源管理器就行，它会自己让开，快捷键和菜单照常可用。
- 支持保存、另存为、导出 HTML 或 PDF，下次打开软件时上一次的工作区和窗口状态会自动恢复。
- 查找替换不需要一个拍在脸上的弹窗，`Ctrl/Cmd + F` 召唤紧凑面板搞定。
- 图片直接拖进文档就行，它们会落进一个可配置的资源目录，无论是本地图片还是在线图片，三种模式下都能正常预览。

目录重命名/删除和工作区级资源限制仍属于后续工作；重要文档请保留备份。

## 尽心保护你和你的内容

Vditor Desktop 把你的写作当作需要保护的内容，而不是可以随时覆盖的数据。在简洁的 Markdown 工作流背后，我们加入了多重保护设计，尽量避免异常退出、其他软件修改文件或文件系统变化时，你的内容被悄悄带走：

- **让每一次跳转都更有分寸：** Markdown 里的网页和邮件链接只会把明确支持的 `http:`、`https:` 和 `mailto:` 交给系统处理；脚本、危险协议和不受信任的应用页面会被拦截，不让一条链接把编辑器带到不该去的地方。
- **更谨慎地保存：** 采用同目录临时文件保存机制；内容未变化时不会重写，保存失败也会保留原文件和编辑器中的未保存内容。
- **异常退出后仍可找回：** 未保存内容会写入私有恢复快照。重新打开软件时，会先检查原文件是否仍保持不变，再决定是否允许保存恢复版本；如果情况不安全，可以将恢复内容另存到其他位置。
- **主动感知外部变化：** 软件会监控所有已打开文件，包括工作区外独立打开的文件。没有本地修改时可以自动重载；存在本地修改时会暂停自动保存，并持续提醒你处理。
- **引导解决内容冲突：** 因外部编辑产生内容冲突时，自带经过悉心设计的引导解决方案──将当前内容另存为、保留为未命名文档、忽略外部变化，或经过明确确认后覆盖磁盘版本。如果磁盘再次发生变化，之前的覆盖确认会自动失效。
- **防读写权限丢失机制：** 文件被删除或暂时无法读写时，编辑器会保留内存中的内容并暂停自动保存，不会偷偷重建或覆盖文件。文件恢复访问后，也不会未经决定就把磁盘版本塞回编辑器──你决定一切。
- **重建文件也留下退路：** 只有在你明确确认后，软件才会重建缺失文件，并把文件变得不可访问那一刻捕获的内容复制到系统剪贴板，同时显示 5 秒确认提示。提示出现后继续输入的内容不会混入这份备份（还有高手？）

## 主题与语言

内置应用主题：

- 浅色
- 深色
- Claude Light
- Claude Dark
- Monokai Pro Light，包含独立的 H1–H6 标题配色
- Monokai Pro Dark，包含独立的 H1–H6 标题配色

可在设置中分别选择浅色与深色应用主题，状态栏主题模式菜单可选择固定浅色、固定深色或跟随系统；常驻图标会显示当前模式。应用主题只改变应用自身的颜色；内容主题和代码块预览主题仍由 Vditor 控制，并分别保留用户在浅色/深色环境中的最后选择。需要时可以启用多平台排版预览。

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

目前 Linux 是主要开发和验证平台；项目已经包含 Windows 和 macOS 的窗口及数据目录适配，但文件监听（watcher）、权限、路径大小写、打包和发布仍需在实体设备上验证。

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

| 平台    | 配置文件                                                                                  | Chromium 数据                                                                    | 恢复数据                                                                         |
| ------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Linux   | `${XDG_CONFIG_HOME:-~/.config}/vditor-desktop/config.toml`                                | `${XDG_DATA_HOME:-~/.local/share}/vditor-desktop/chromium/`                      | `${XDG_DATA_HOME:-~/.local/share}/vditor-desktop/recovery/`                      |
| Windows | `%APPDATA%\\vditor-desktop\\config.toml`                                                  | `%LOCALAPPDATA%\\vditor-desktop\\chromium\\`                                     | `%LOCALAPPDATA%\\vditor-desktop\\recovery\\`                                     |
| macOS   | `~/Library/Application Support/com.github.studio-200a.vditor-electron/Config/config.toml` | `~/Library/Application Support/com.github.studio-200a.vditor-electron/Chromium/` | `~/Library/Application Support/com.github.studio-200a.vditor-electron/recovery/` |

TOML 配置文件可直接阅读，按应用、外观、字体、编辑器、预览、文件、工作区、窗口和会话设置分类。外观部分分别保存 `lightTheme` 和 `darkTheme`；状态栏主题模式菜单提供固定浅色、固定深色和跟随系统三种模式，`systemTheme` 记录第三种选择，并根据这两项偏好解析当前主题。Claude 应用主题只定义应用颜色，不替代 Vditor 的内容主题或代码块主题设置。

异常恢复快照单独存放在上表所列的私有应用数据目录中；保存或放弃恢复后会删除，且不会被作为本地文档资源提供。

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

## 开源项目

Vditor Desktop 的实现离不开以下开源项目。各项目作者保留其版权和许可证权利，完整依赖关系图见 [`package-lock.json`](package-lock.json)。

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
- [Lucide](https://lucide.dev) · [lucide-static](https://www.npmjs.com/package/lucide-static)（ISC）：提供应用界面、查找替换和文件树使用的 SVG 图标；`lucide-static` 仅在构建期复制选定资源，不引入 React。

</details>

## 免责声明

Vditor Desktop 用于本地 Markdown 编辑，软件仍在持续完善。请为重要文件保留备份，并在正式使用导出的内容前先检查一遍。作者及贡献者不对因使用本项目造成的任何文件丢失、损坏、数据错误或其他损失和责任承担责任。

## 许可证

Vditor Desktop 采用 [MIT License](LICENSE) 发布。
