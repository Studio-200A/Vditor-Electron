# Vditor Desktop 主题架构

> 本文是 Vditor Desktop 主题系统的长期设计与实现说明。当前主题扩展最初作为 0.2.0 计划外的“批次 6.5”启动，并由批次 6.6 补齐为六套主题；施工记录保留在 [`docs/13-0.2.0-EXECUTION-TRACKER.md`](13-0.2.0-EXECUTION-TRACKER.md) 中。

## 1. 主题系统的职责边界

Vditor Desktop 的主题系统分为应用壳层主题和 Vditor 内容主题两层。应用壳层负责桌面工作区的视觉环境，Vditor 负责 Markdown 编辑与渲染内容的表现。

应用壳层主题负责标题栏、菜单、状态栏、标签栏、sidebar、文件树、大纲、设置面板、编辑器宿主背景、边框、分割线、焦点环、按钮状态和主题预览。

以下内容不由应用主题定义：

- 字体、字号、字体缩放和排版设置；
- Vditor 的 content theme；
- Vditor 的 code theme 及代码块语法高亮；
- SV 模式源码编辑区的上游编辑表现。

Vditor 原生工具栏中的代码预览主题设置控制 WYSIWYG、IR 和 SV 预览区代码块的高亮风格。应用主题不重复定义这部分颜色，从而尊重 Vditor 的上游能力和升级边界。

Monokai Pro Dark 和 Monokai Pro Light 是历史实现中的例外：应用 CSS 额外提供了少量内容可读性修正和 H1–H6 标题色，以保持既有视觉特征；代码块高亮仍由 Vditor code theme 控制。Claude 主题不复制这组内容层覆盖。

## 2. 当前实现分层

| 层 | 位置 | 职责 |
| -- | ---- | ---- |
| 配置模型 | `src/main/services/app-state.ts` | 定义当前主题、亮色偏好、暗色偏好和内容/代码主题字段 |
| 配置存储 | `src/main/services/settings-store.ts` | 校验并持久化主题枚举和主题偏好 |
| 设置界面 | `src/renderer/index.html` | 渲染亮色/暗色独立 radio 组和主题预览 SVG；系统匹配模式由状态栏菜单控制，不在设置页重复提供 |
| 主题控制器 | `src/renderer/app.js` | 解析当前主题、应用 `data-theme`、切换 Vditor 内容/代码主题、同步状态栏三态主题菜单 |
| 应用视觉变量 | `src/renderer/styles/app.css` | 为六套壳层主题提供 CSS 变量和必要的组件覆盖 |
| Vditor 边界 | `src/renderer/vditor-adapter.js` | 集中处理 Vditor toolbar、主题菜单和私有 DOM 结构访问 |
| 行为测试 | `tests/unit/*`、`tests/e2e/app.spec.ts` | 覆盖配置、主题控件、颜色契约、主题切换和真实 Electron 行为 |

应用主题通过 `document.documentElement.dataset.theme` 生效。CSS 使用 `:root[data-theme='...']` 切换变量组；Vditor 实例继续通过 `setTheme(editorTheme, contentTheme, codeTheme, cssPath)` 接收编辑器、内容和代码主题参数。

## 3. 当前状态模型

### 3.1 六套应用主题

| 色调 | 配置值 | 显示名称 | 默认状态 |
| ---- | ------ | -------- | -------- |
| 亮色 | `classic` | Light | `lightTheme` 默认值 |
| 亮色 | `claude-light` | Claude Light | 可选 |
| 亮色 | `monokai-pro-light` | Monokai Pro Light | 可选 |
| 暗色 | `dark` | Dark | `darkTheme` 默认值 |
| 暗色 | `claude-dark` | Claude Dark | 可选 |
| 暗色 | `monokai-pro-dark` | Monokai Pro Dark | 可选 |

### 3.2 亮暗主题独立选择

设置页分别保存：

- `lightTheme`：`classic`、`claude-light` 或 `monokai-pro-light`；
- `darkTheme`：`dark`、`claude-dark` 或 `monokai-pro-dark`。

`theme` 表示固定亮/暗模式下的当前应用主题，`systemTheme` 表示状态栏主题模式是否选择系统自动匹配。TOML 文件使用 `[appearance]` 段落承载这些字段，但 `AppSettings` 中它们是顶层字段。设置页只编辑 `lightTheme` 与 `darkTheme`，三态模式从状态栏主题菜单选择。解析关系为：

```text
状态栏显示器模式
  → systemTheme = true
  → nativeTheme / appAPI.getSystemTheme()
  → 亮色时使用 lightTheme，暗色时使用 darkTheme

状态栏太阳模式
  → systemTheme = false
  → theme = lightTheme

状态栏月亮模式
  → systemTheme = false
  → theme = darkTheme
```

旧字段 `lastLightTheme` 和 `lastDarkTheme` 不做兼容迁移；配置读取时作为未知字段忽略。

### 3.3 内容主题和代码主题

Vditor 内容和代码主题仍各自保存亮暗偏好：`lightCodeTheme` / `darkCodeTheme` 分别保存两种色调下的代码主题；`contentTheme` 保存 Vditor 内容主题。当 `contentTheme` 为 `light` 或 `dark` 时，会随应用壳层明暗联动；选择具体内容主题时则保持显式选择。

应用切换到 Claude Light 或 Claude Dark 时，只改变应用壳层变量，并根据当前明暗状态选择对应的 Vditor 内容/代码主题偏好。

## 4. 语义颜色变量

### 4.1 基础变量

`src/renderer/styles/app.css` 以 CSS 变量作为应用主题的单一颜色入口：

- `--bg`：应用整体背景；
- `--panel` / `--panel-2`：卡片、输入控件和次级面板；
- `--hover`：通用 hover 表面；
- `--text` / `--muted`：正文和弱化文字；
- `--border`：边框和分割线；
- `--accent`：当前主题交互强调色和键盘焦点环；
- `--on-accent`：accent 背景上的默认前景色；
- `--brand-accent`：品牌或主题强调场景使用的 accent；
- `--danger`：危险操作颜色。

按钮、焦点环和状态提示应引用语义变量，不应在组件规则中重复写主题专属颜色。

### 4.2 Sidebar 与编辑区表面

应用使用两个专门的表面变量：`--sidebar-surface` 表示文件树和侧栏内容的基准表面，`--editor-surface` 表示编辑器宿主、Vditor 内容区以及设置页具体内容的表面。

| 主题 | `--bg` | `--sidebar-surface` | `--editor-surface` | 视觉策略 |
| ---- | ------ | ------------------- | ----------------- | -------- |
| Classic | `#f7f7f8` | `#f0f1f3` | `#ffffff` | 导航壳层略灰，文档画布为白色 |
| Dark | `#17181a` | `#202124` | `#18191c` | 编辑区相对 sidebar 各 RGB 通道差 8 |
| Claude Light | `#faf9f5` | `#f5f4ed` | `#faf9f5` | 暖灰 sidebar，纸张感编辑区 |
| Claude Dark | `#141413` | `#30302e` | `#262624` | 暖暗导航壳层略亮，文档画布略深 |
| Monokai Pro Dark | `#2d2a2e` | `#2d2a2e` | `#272428` | 保留 Monokai 色调，文档画布略深 |
| Monokai Pro Light | `#faf4f2` | `#ede7e5` | `#faf4f2` | sidebar 略深一档、编辑区暖白，Monokai Pro Dark 的同族浅色 |

`.sidebar`、Windows/Linux 自定义主菜单的触发按钮与下拉菜单、titlebar、共享 Vditor toolbar、Files/Outline tabs、无标签的 `.editor-area` 及其新建/打开操作都使用 `--sidebar-surface`；这样顶部 chrome、菜单与空工作区随六套主题呈现同一中性导航壳层色，不与输入控件共用 `--panel` 的白色或近白色表面。`--panel-2` 保留给状态栏、设置导航等次级表面。编辑器宿主、`.vditor-content`、`.vditor-sv`、`.vditor-ir`、`.vditor-wysiwyg`、`.vditor-preview`、`.vditor-reset` 以及 SV 行号栏使用 `--editor-surface`，使行号栏成为文档画布的一部分，仅由右侧边框分隔。浅色主题的文档画布较导航壳层明亮，深色主题则较暗；设置页具体内容区域也使用编辑区表面。标签 hover 一律使用主题的 `--hover`，不使用跨主题固定颜色。

## 5. 六套主题的实际实现

### 5.1 Classic

默认亮色壳层。sidebar 为白色、编辑区为浅灰色，accent 为 `#3578e5`，作为 `lightTheme` 的默认和保底值，通常搭配 Vditor 的浅色内容/代码主题。

### 5.2 Dark

基础深色壳层。sidebar 为 `#202124`，编辑区为 `#18191c`，两个 surface 的 RGB 通道差固定为 8；accent 为 `#69a2ff`，作为 `darkTheme` 的默认值，通常搭配 Vditor 的深色内容/代码主题。

### 5.3 Claude Light

采用 Anthropic 风格暖色纸张视觉：`--bg` 和编辑区为 `#faf9f5`，sidebar 为 `#f5f4ed`，文字为 `#141413`，弱化文字为 `#73726c`，accent 和品牌强调色为 `#d97757`。sidebar hover 使用 `#e8e6dc`，边框使用 `rgb(31 30 29 / 30%)`，主按钮强制使用白色文字。该主题不定义字体、内容主题或代码高亮。

### 5.4 Claude Dark

将 Claude Light 的暖色体系转换为低对比度深色壳层：应用背景为 `#141413`，sidebar 和编辑区均为 `#30302e`，次级面板为 `#262624`，hover 表面为 `#3d3d3a`，文字为 `#faf9f5`，弱化文字为 `#c2c0b6`。accent 和品牌强调色同样为 `#d97757`，分割线使用 `rgb(222 220 209 / 12%)`，主按钮使用白色文字。

### 5.5 Monokai Pro Dark

既有深色主题。应用、sidebar 和编辑区基准表面为 `#2d2a2e`，accent 为 Monokai 黄色 `#ffd866`，并使用 Monokai 风格的输入背景、代码块背景、链接、引用和分割线颜色。应用 CSS 为 H1–H6 提供粉、黄、绿、青、紫、橙六级标题色；这些内容可读性覆盖是 Monokai 的历史特例，代码块高亮仍由 Vditor code theme 提供。

### 5.6 Monokai Pro Light

Monokai Pro Dark 的同族浅色主题，调色取自官方 Monokai Pro Light VS Code 主题（非 Filter Sun）。应用和编辑区基准表面为暖白 `#faf4f2`，sidebar 为略深的 `#ede7e5`，次级面板为 `#e0dad9`，文字为 `#29242a`，弱化文字为 `#706b6e`，accent 和品牌强调色为 Monokai 红 `#e14775`。与 Monokai Pro Dark 一样，应用 CSS 复用输入背景、代码块背景、链接、引用和分割线的内容可读性覆盖，并为 H1–H6 提供红、橙、绿、蓝、紫、黑六级标题色；代码块高亮仍由 Vditor code theme 提供。

## 6. 主题选择器与预览

设置页使用两个 fieldset：亮色应用主题和暗色应用主题。每个选项包含 radio input、主题预览 SVG 和本地化名称。

预览卡片使用统一最大宽度和统一网格约束。亮色和暗色选项数量不同不改变单卡片宽度；可用空间不足时整体缩小。预览只表现应用壳层的结构和颜色，不模拟 Vditor 的代码高亮主题。

新增主题时应加入对应色调的 radio 组、SVG 预览类、CSS 变量和测试，不应为单个主题组增加独立布局规则。

## 7. 测试契约

当前测试覆盖配置字段、旧字段忽略、亮暗独立主题组、六张预览卡片、预览宽度、Claude surface/accent/按钮文字/hover/分割线、状态栏三态主题菜单、系统主题解析，以及编辑器在失焦、聚焦和 IR/WYSIWYG/SV 切换时的编辑区表面。

截至 2026-08-27，用户手动运行的 Linux `npm run check:all` 已包含主题、状态栏菜单、工具栏边界和六套主题相关回归；Windows/macOS 的窗口系统主题和原生集成仍按 [`docs/03-CROSS-PLATFORM.md` §9](03-CROSS-PLATFORM.md#9-020-batch-7-deferred-platform-validation) 单独验证。

Vditor toolbar 的主题菜单继续由 adapter 管理，应用主题不会绕过 Vditor 的 code theme。涉及主题代码、renderer shell 或设置持久化的改动，应至少运行格式检查、相关单测、构建和相关 Electron E2E；合并前遵循项目要求运行 `npm run check:all`。

## 8. 扩展规则

后续新增应用主题时：

1. 确定其亮色/暗色归属，并在 `AppSettings` 中加入明确枚举值。
2. 通过 `:root[data-theme='...']` 提供完整变量组。
3. 复用 `--sidebar-surface` 和 `--editor-surface`，按视觉结果决定两者关系。
4. 不在主题中定义字体、Vditor 内容主题或代码块高亮。
5. 只在确有上游不足时增加应用层内容覆盖，并记录原因。
6. 更新设置预览、本地化、单测、E2E、README、CHANGELOG 和本文件。
