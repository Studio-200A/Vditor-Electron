# Vditor Desktop

[简体中文](README_CN.md) · English

<p align="center">
  <img src="src/renderer/assets/vditor-desktop.svg" alt="Vditor Desktop" width="128" />
</p>

<p align="center">
  A calm, local-first Markdown editor for people who want the power of Vditor in a focused desktop workspace.
</p>

<p align="center">
  <a href="https://github.com/Studio-200A/Vditor-Electron/releases"><img src="https://img.shields.io/badge/version-0.1.5-blue" alt="Version 0.1.5" /></a>
  <a href="https://github.com/Studio-200A/Vditor-Electron/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" /></a>
  <a href="https://github.com/Studio-200A/Vditor-Electron"><img src="https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20macOS-lightgrey" alt="Linux, Windows and macOS" /></a>
  <a href="https://github.com/prettier/prettier"><img src="https://img.shields.io/badge/code_style-prettier-ff69b4.svg" alt="code style: prettier" /></a>

</p>

Vditor Desktop is a local Markdown writing app built with [Electron](https://github.com/electron/electron) and [Vditor](https://github.com/Vanessa219/vditor). Your files remain ordinary Markdown files on your computer, while the app adds the details that make a desktop editor feel complete: tabs, workspaces, a file explorer, document outline, themes, session recovery, and native file associations.

![Vditor Desktop light theme](assets/screenshot-light.webp)

![Vditor Desktop Monokai Pro Dark theme](assets/screenshot-monokai-dark.webp)

## Contents

- [Why Vditor Desktop](#why-vditor-desktop)
- [Editing modes](#editing-modes)
- [A workspace that stays out of the way](#a-workspace-that-stays-out-of-the-way)
- [Themes and languages](#themes-and-languages)
- [Install and run](#install-and-run)
- [Everyday shortcuts](#everyday-shortcuts)
- [Configuration and data](#configuration-and-data)
- [Build and test](#build-and-test)
- [Contributing](#contributing)
- [Open-source software](#open-source-software)
- [Disclaimer](#disclaimer)
- [License](#license)

## Why Vditor Desktop

- **Markdown without lock-in.** Open and save regular `.md` files directly. There is no account, cloud sync, proprietary document format, or required service.
- **Three ways to write.** Move between WYSIWYG, instant rendering, and split preview mode without leaving the document.
- **Desktop-grade file handling.** Open files from the command line or a file manager, work with a folder as a workspace, and recover tabs and window state between sessions.
- **Workspace-aware file operations.** Create numbered untitled documents, create and rename files inline, open a workspace from the explorer context menu, and move files to the trash without leaving the editor.
- **Editing context menu.** Right-click in any editable mode for clipboard, deletion, and context selection actions; rendered table cells also offer row and column actions.
- **A focused interface.** A compact workbench bar keeps menus, file actions, tabs, and window controls together, while the editor toolbar appears only when needed.
- **Rich Markdown.** Keep Vditor's support for formulas, diagrams, charts, footnotes, syntax highlighting, tables of contents, and media previews.
- **Local-first by design.** Configuration and Chromium data are stored locally in platform-appropriate directories. The application does not upload your documents.

## Editing modes

| Mode                  | Best for                                                                                |
| --------------------- | --------------------------------------------------------------------------------------- |
| **WYSIWYG**           | Writing and formatting while seeing the final document appearance.                      |
| **Instant Rendering** | Keeping Markdown syntax near the cursor while the rest of the document renders cleanly. |
| **Split Preview**     | Editing Markdown source on the left and reviewing the rendered document on the right.   |

Switch modes from the unified toolbar or **View → Editing Mode**. Split Preview includes source line numbers, configurable tab spacing, optional whitespace markers, a resizable divider, and an auto-hiding preview scrollbar.

## A workspace that stays out of the way

- Open a folder as a workspace and browse its Markdown files in the explorer.
- Expand and collapse directories, filter by extension, create and rename files, move items to the trash, or reveal them in the system file manager.
- Read an H1–H6 document outline and jump to headings from any editing mode.
- Keep multiple documents open in numbered untitled tabs, with independent undo history and modified state.
- Drag tabs to arrange them in the order that fits your work.
- Collapse the explorer to give the editor more room; its file actions fold away with it while menus and shortcuts remain available.
- Save, Save As, export HTML or PDF, and recover the last workspace and window state.
- Save documents safely through a same-directory temporary file; unchanged files are not rewritten, and a failed save keeps the original file and your unsaved editor content intact.
- Recover unsaved work after an unexpected exit. Recovered documents open directly with a warning banner: save the recovered version when its original file is unchanged, or save elsewhere when the disk version changed or the original file is unavailable.
- Find and replace text in the active document with a compact `Ctrl/Cmd + F` panel.
- Detect changes to files in the active workspace. Clean documents reload automatically; documents with local edits show a persistent conflict banner and pause autosave until you choose how to proceed.
- Paste or upload images to a configurable relative assets directory. Relative local images and online images can be previewed in all three modes.

External file monitoring currently covers files in the active workspace and Untitled documents whose expected workspace path appears. Files opened outside the workspace, file deletion recovery, directory moves, and conflict recovery across application restarts remain planned reliability work; keep backups of important documents.

## Themes and languages

Built-in application themes:

- Light
- Dark
- Monokai Pro Dark, including a dedicated H1–H6 heading palette

The theme switch remembers the last dark theme. Content and code-block preview themes follow the light/dark application context while preserving the user's last selection in each context. Optional multi-platform typography previews can be enabled when needed.

The interface is localized in English (`en_US`), Simplified Chinese (`zh_Hans`), Traditional Chinese (`zh_Hant`), and system language mode.

## Install and run

### From source

Node.js 22 or a compatible version and npm are required:

```bash
git clone https://github.com/Studio-200A/Vditor-Electron.git
cd Vditor-Electron
npm ci
npm start
```

The build copies Vditor's bundled assets locally; runtime use does not depend on a Vditor CDN.

### Linux builds

The repository can produce a Linux unpacked application, a portable archive, and an AppImage:

```bash
npm run pack                 # release/linux-unpacked
npm run release:linux       # all Linux artifacts
```

The release command produces:

```text
release/vditor-desktop-x86_64-<version>-portable.tar.gz
release/vditor-desktop-x86_64-<version>-portable.AppImage
```

The portable desktop entry uses `/path/to/vditor-desktop` as an installation-path placeholder. Replace it with the actual extraction path before installing the entry into your desktop environment. The AppImage can be run after making it executable.

Linux is the primary development and validation platform at present. Windows and macOS-specific window and data-directory adaptations are included for future platform builds.

## Everyday shortcuts

| Action            | Shortcut               |
| ----------------- | ---------------------- |
| New file          | `Ctrl/Cmd + N`         |
| Open file         | `Ctrl/Cmd + O`         |
| Save              | `Ctrl/Cmd + S`         |
| Save As           | `Ctrl/Cmd + Shift + S` |
| Find and replace  | `Ctrl/Cmd + F`         |
| Select context / all | `Ctrl/Cmd + A`      |
| Close tab         | `Ctrl/Cmd + W`         |
| Toggle explorer   | `Ctrl/Cmd + B`         |
| Open settings     | `Ctrl/Cmd + ,`         |
| Toggle Chrome DevTools (when enabled) | `Ctrl/Cmd + Shift + I` |
| Toggle fullscreen | `F11`                  |

## Configuration and data

Application configuration and Chromium user data are kept separate:

| Platform | Configuration | Chromium data | Recovery data |
| -------- | ------------- | ------------- | ------------- |
| Linux    | `${XDG_CONFIG_HOME:-~/.config}/vditor-desktop/config.toml` | `${XDG_DATA_HOME:-~/.local/share}/vditor-desktop/chromium/` | `${XDG_DATA_HOME:-~/.local/share}/vditor-desktop/recovery/` |
| Windows  | `%APPDATA%\\vditor-desktop\\config.toml` | `%LOCALAPPDATA%\\vditor-desktop\\chromium\\` | `%LOCALAPPDATA%\\vditor-desktop\\recovery\\` |
| macOS    | `~/Library/Application Support/com.github.studio-200a.vditor-electron/Config/config.toml` | `~/Library/Application Support/com.github.studio-200a.vditor-electron/Chromium/` | `~/Library/Application Support/com.github.studio-200a.vditor-electron/recovery/` |

The TOML file is human-readable and grouped by application, appearance, typography, editor, preview, files, workspace, window, and session settings.

Crash-recovery snapshots are stored separately in the private application data directory shown above. They are removed after saving or discarding the recovered document and are never served as local document resources.

## Build and test

```bash
npm run format:check
npm run lint
npm run typecheck
npm run check:vditor
npm test
npm run check:all
```

The Vditor dependency is intentionally pinned to 3.11.3. Before upgrading it, read [the Vditor upgrade notes](docs/20-VDITOR-UPGRADE.md) and validate the adapter boundary and Electron regression tests.

## Contributing

Development happens on version- or feature-specific `dev-*` / `feat-*` branches and is merged into `main` through pull requests. Useful contributions include:

- reproducible bug reports with OS, desktop environment, display protocol, version, and steps;
- fixes and tests for editor, file, workspace, and platform behavior;
- documentation, translations, accessibility, and visual polish;
- reviews of the planned work in [`docs/`](docs/README.md).

Please keep the project local-first and preserve the security boundaries described in the repository instructions.

## Open-source software

Vditor Desktop is made possible by the following open-source projects. Their authors retain their respective copyrights and licenses. The complete dependency graph is recorded in [`package-lock.json`](package-lock.json).

<details>
<summary>Runtime and direct dependencies</summary>

| Project                                                        | Role                               | License                 |
| -------------------------------------------------------------- | ---------------------------------- | ----------------------- |
| [Electron](https://github.com/electron/electron)               | Cross-platform desktop runtime     | MIT                     |
| [Chromium](https://github.com/chromium/chromium)               | Electron's rendering engine        | BSD-3-Clause and others |
| [Node.js](https://github.com/nodejs/node)                      | Main-process runtime               | MIT and others          |
| [Vditor](https://github.com/Vanessa219/vditor)                 | Markdown editor and renderer       | MIT                     |
| [chokidar](https://github.com/paulmillr/chokidar)              | File change monitoring             | MIT                     |
| [@iarna/toml](https://github.com/iarna/iarna-toml)             | TOML configuration storage         | ISC                     |
| [diff-match-patch](https://github.com/JackuB/diff-match-patch) | Text diff algorithm used by Vditor | Apache-2.0              |

</details>

<details>
<summary>Bundled Markdown rendering components</summary>

- [abcjs](https://github.com/paulrosen/abcjs) · [Apache ECharts](https://github.com/apache/echarts) · [flowchart.js](https://github.com/adrai/flowchart.js)
- [Viz.js](https://github.com/mdaines/viz-js) · [Graphviz](https://gitlab.com/graphviz/graphviz) · [highlight.js](https://github.com/highlightjs/highlight.js)
- [KaTeX](https://github.com/KaTeX/KaTeX) · [Lute](https://github.com/88250/lute) · [markmap](https://github.com/markmap/markmap)
- [MathJax](https://github.com/mathjax/MathJax) · [Mermaid](https://github.com/mermaid-js/mermaid) · [plantuml-encoder](https://github.com/markushedvall/plantuml-encoder)
- [SmilesDrawer](https://github.com/reymond-group/smilesDrawer) · [WaveDrom](https://github.com/wavedrom/wavedrom) · [Ant Design Icons](https://github.com/ant-design/ant-design-icons) · [Material Design Icons](https://github.com/google/material-design-icons)

</details>

<details>
<summary>Development, testing, and packaging</summary>

- [TypeScript](https://github.com/microsoft/TypeScript) · [ESLint](https://github.com/eslint/eslint) · [typescript-eslint](https://github.com/typescript-eslint/typescript-eslint)
- [Prettier](https://github.com/prettier/prettier) · [Vitest](https://github.com/vitest-dev/vitest) · [jsdom](https://github.com/jsdom/jsdom)
- [Playwright](https://github.com/microsoft/playwright) · [electron-builder](https://github.com/electron-userland/electron-builder) · [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped)

</details>

## Disclaimer

Vditor Desktop is provided for local Markdown editing and is still evolving. Use it with backups of important files and review exported content before relying on it. The author and contributors are not responsible for any loss, damage, data corruption, or other liability resulting from the use of this project.

## License

Vditor Desktop is released under the [MIT License](LICENSE).
