# 批次 2 剩余 + 批次 3 交接文档

> 写给新 Session 的 Agent，启动 0.2.5 批次 2 剩余工作（CSS 主题拆分、notifications/dialogs）和批次 3（AppStore 与文档状态模型）。

## 项目概况

- **仓库**：`/home/shawnzhang/Projects/Vditor-Electron`
- **分支**：`dev-0.2.5`
- **版本**：0.2.0 已发布（`v0.2.0` tag = `bfaf25a`）；当前开发 0.2.5（渲染层架构重构）
- **环境**：Fedora Workstation Linux，`DISPLAY=:0`，E2E 可正常运行（无容器/沙箱限制）
- **参考 worktree**：`../Vditor-Electron-0.2.0-reference`（detached @ `bfaf25a`，批次 11 前保持不动）

## 批次 1-2 完成情况

### 批次 1：Renderer TypeScript 构建管线与组合入口（已完成）

| 交付物                   | 位置                            | 说明                                                                                     |
| ------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------- |
| esbuild 构建脚本         | `scripts/build-renderer.js`     | 将 `src/renderer/main.ts` 打包为 `dist/renderer/main.js`（IIFE）+ `pure-functions.ts` → `dist/renderer/pure-functions.js` |
| renderer TypeScript 配置 | `tsconfig.renderer.json`        | strict 模式，ES2022，DOM lib，noEmit                                                     |
| 组合入口                 | `src/renderer/main.ts`          | 验证全局 API → LifecycleManager → LegacyAppController → beforeunload dispose             |
| 核心模块                 | `src/renderer/core/`            | controller.ts、disposables.ts、dom.ts、lifecycle.ts                                      |
| 类型声明                 | `src/renderer/types/`           | bridges.d.ts、vditor.d.ts、adapter.d.ts、locales.d.ts                                    |
| 共享契约骨架             | `src/shared/contracts/index.ts` | ResultCode、WriteResult、DocumentIdentity、FileListItem                                  |
| 25 条新单元测试          | `tests/unit/renderer/`          | dom（7）、lifecycle（8）、disposables（10）                                              |

### 批次 2：纯函数与基础 UI 域迁移（核心部分已完成）

| 交付物                   | 位置                            | 说明                                                                                     |
| ------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------- |
| 字符串纯函数             | `src/renderer/utils/strings.ts` | `escapeHTML`、`fileName`、`stripExtension`                                               |
| 行尾纯函数               | `src/renderer/utils/line-ending.ts` | `detectLineEnding`（返回 `'CRLF' \| 'LF'`）                                          |
| 主题常量与判定           | `src/renderer/ui/theme.ts`      | `DARK_THEMES`、`LIGHT_THEMES`、`ALL_THEMES`、`THEME_MODES`、`isDarkTheme`；导出 `AppTheme`、`ThemeMode` 类型 |
| 本地化纯函数             | `src/renderer/ui/localization.ts` | `resolveLocale`、`translate`、`formatIpcErrorMessage`、`IPC_ERROR_MESSAGE_KEYS`          |
| 主题控制器纯函数         | `src/renderer/ui/theme-controller.ts` | `resolveEffectiveTheme`、`resolveThemeMode`、`validateDarkTheme`、`validateLightTheme`、`getPreferredCodeTheme`、`resolveContentTheme` |
| 纯函数 bundle 入口       | `src/renderer/pure-functions.ts` | esbuild 入口，打包为 `dist/renderer/pure-functions.js`，暴露 `window.__vditorDesktopPureFunctions` |
| 58 条新单元测试          | `tests/unit/renderer/`          | strings（16）、line-ending（5）、theme（12）、localization（15）、theme-controller（15） |

**验证结果**（批次 1-2 实际跑过的）：

- `format:check` ✓ / `lint` ✓ / `typecheck` ✓ / `typecheck:renderer` ✓ / `build` ✓ / `check:vditor` ✓
- `npm test`：26 文件 270/270 通过（原 212 + 新增 58）
- `npm run check:all`：270/270 单元 + 142/142 E2E = 412 条全部通过（用户手测确认）

**关键架构变化**：

- `src/renderer/app.js` 不再自动初始化，改为 `window.__vditorDesktopLegacyBootstrap = init;`
- `src/renderer/main.ts` 作为组合入口控制启动时机
- `index.html` 脚本加载顺序：Vditor → locales.js → vditor-adapter.js → **pure-functions.js** → app.js → main.js
- `app.js` 删除了 14 个旧函数/常量定义，改为从 `window.__vditorDesktopPureFunctions` 导入并包装为本地函数
- `dist/` 不含 `.ts` 源码（copy-vditor-assets.js 已跳过）

## 批次 2 剩余工作

摘自 `docs/15-0.2.5-EXECUTION-TRACKER.md` §6 批次 2 施工卡：

> **目标**：完成六套主题样式的职责拆分，迁移 notifications/dialogs 为独立模块。

**剩余子步骤**：

1. **逐主题迁移 CSS**：先记录六套主题的 computed-style 与关键交互基线（批次 0 已保存 36 张基准截图于 `../Vditor-Electron-0.2.5-baseline-screenshots/`），一次迁移一个主题的变量和专属覆盖到 `styles/themes/`，保留语义变量（`--sidebar-surface`、`--editor-surface`、`--accent` 等），验证后删除 `app.css` 对应旧规则；Monokai 内容可读性与 H1-H6 颜色历史特例单独标记。
2. **主题文件组合方式**（`@import`、构建合并或 bundler）必须用构建检查和 E2E 验证最终产物，不只验证源码目录。
3. **迁移 notifications、dialogs** 为独立控制器/模块，补齐行为测试。这两个模块是 DOM 密集型操作，需要 jsdom 环境测试。
4. **将本域相关的 `renderer-shell.test.ts` 源码字符串检查替换为行为测试**。

**不包含**：不迁移状态、文档、编辑器域；不改变任何主题的最终计算样式；不新增主题。

**必须证明**：

- 设置、状态栏开关、系统主题切换和三种编辑模式下主题无回归
- 离线资源路径、构建产物和 CSS 顺序稳定
- 组件未重新硬编码主题颜色
- notifications/dialogs 模块有单元测试覆盖

**用户手测重点**：逐一切换六套主题、三种编辑模式和三种工具栏，与批次 0 基准截图对比。

## 批次 3 施工卡要点

摘自 `docs/15-0.2.5-EXECUTION-TRACKER.md` §6：

> **目标**：对应计划第 7-9、17 节。建立整个重构的关键状态基础：类型、受控 store、快照投影。

**有序子步骤**：

1. 定义 `AppState`、`DocumentState`、`EditorRuntime`、`ExternalConflict` 等类型；文档数据与 Vditor 运行时句柄拆为两个关联对象；区分 `filePath`/display path 与 canonical `fileIdentity`。
2. 建立 AppStore 受控修改 API；为每个状态域记录 source of truth、唯一业务写入者、公开命令和只读消费者；通用 patch 只留在所有者内部。
3. 把 `activeTab()`、标签查找和标签状态更新迁移到 store/文档模型；UI 派生状态与真实文档状态分开；ignored external changes、recovery 标识等放到正确所有者。
4. 定义版本化的 session/recovery 快照 DTO（放入 `src/shared/contracts/`）与显式白名单投影/恢复函数；测试证明运行时句柄不进入快照。
5. 增加状态转换测试：新建、激活、modified、保存成功、冲突、关闭、恢复。
6. 将旧 `state` 对象改为经由 store 访问；若需过渡适配器只允许存在于组合入口，并记录删除阶段。

**不包含范围**：不迁移保存/打开/关闭的用例实现（批次 4）；不迁移 Vditor 生命周期（批次 5）；不引入 Redux 或事件总线。

**必须证明**：

- 状态域公开接口不暴露通用写入口
- 冲突和不可用状态携带产生时的 identity
- 快照投影只复制契约字段且恢复函数在边界验证版本与结构
- 重复 dispose、迟到结果失效的测试接口（`DisposableBag` 或等价物）可用且幂等
- 模块无循环依赖

**用户手测重点**：常规打开、编辑、保存、切换标签、重启恢复，确认行为与 0.2.0 一致。

## 本 Session 工作规则

以下规则由用户明确要求，**必须遵守**：

### 1. 专项测试按需运行

可以运行需要沙箱外权限的专项测试（E2E、构建验证等）。使用以下命令按需选择：

```bash
npm run build                    # 编译 main + renderer 并复制静态资源
npm test                         # 单元测试（vitest）
npm run check:vditor             # Vditor 版本锁定检查
npm run format:check             # Prettier 格式检查
npm run lint                     # ESLint
npm run typecheck                # main/preload TypeScript
npm run typecheck:renderer       # renderer TypeScript
node scripts/run-electron-e2e.js tests/e2e/<file>.spec.ts -g "<test name>"  # 单条 E2E
```

### 2. 全量测试留给用户手动

**不要运行** `npm run check:all` 或 `npm run check`。全量 E2E 由用户在手动测试阶段运行。

### 3. 代码修改后同步开发文档

每次有实质性代码/结构变化后，同步更新以下文档：

- **`CHANGELOG.md`**：用户可见的行为变化（0.2.5 主要是内部架构变化，用户功能基本不变，但仍需记录重要结构变化）
- **`docs/15-0.2.5-EXECUTION-TRACKER.md`**：批次执行记录（§10），包括实施进度、验证结果、遗留问题
- **`docs/01-CODE-STRUCTURE.md`**：代码架构全景——新增文件/目录/模块时需要更新
- **其它受影响的文档**：如果批次修改涉及跨平台、文件安全、主题、Vditor 升级等领域，同步更新对应的 `docs/03-CROSS-PLATFORM.md`、`docs/05-FILE-SAFETY.md`、`docs/04-THEMES.md`、`docs/20-VDITOR-UPGRADE.md` 等

### 4. 不做 git commit

**不要执行 git add / git commit**。所有改动留在工作区，用户手动运行全量测试通过后自行 commit。

## 关键技术约束（摘自 AGENTS.md）

- Vditor 保持 **3.11.3**，不修改 vendored 文件
- `contextIsolation: true` + `nodeIntegration: false` 保持不变
- preload 只增窄接口，不加通用 IPC 包装
- renderer 不能 import Node 内置模块
- 依赖方向：启动组合层 → 领域控制器 → 基础服务，无循环依赖
- 文件命名：kebab-case；类/接口用 PascalCase；函数/变量用 camelCase
- 代码格式遵循根目录 `.prettierrc.json`，lint 遵循 `eslint.config.mjs`

## 批次 2 遗留的关键接口

### 组合入口与生命周期

```typescript
// src/renderer/core/controller.ts
export interface Controller {
  init(): void | Promise<void>;
  dispose(): void;
}

// src/renderer/core/lifecycle.ts
export class LifecycleManager {
  async registerAndInit(name: string, controller: Controller): Promise<void>;
  dispose(): void;
}

// src/renderer/core/disposables.ts
export class DisposableBag {
  add(cleanup: Cleanup): void;
  addEventListener(target, type, listener, options?): void;
  addTimeout(id): void;
  addAnimationFrame(id): void;
  addInterval(id): void;
  addObserver(observer): void;
  dispose(): void;
}
```

### DOM 辅助

```typescript
// src/renderer/core/dom.ts
export function requiredElement<T extends Element = HTMLElement>(
  selector: string,
  root?: ParentNode,
): T;

export function optionalElement<T extends Element = HTMLElement>(
  selector: string,
  root?: ParentNode,
): T | null;
```

### 纯函数暴露

```typescript
// window.__vditorDesktopPureFunctions（由 pure-functions.js 暴露）
{
  escapeHTML: (value: unknown) => string;
  fileName: (filePath: string) => string;
  stripExtension: (name: string) => string;
  detectLineEnding: (content: string) => 'CRLF' | 'LF';
  isDarkTheme: (theme: string) => boolean;
  DARK_THEMES: readonly ['dark', 'claude-dark', 'monokai-pro-dark'];
  LIGHT_THEMES: readonly ['classic', 'claude-light', 'monokai-pro-light'];
  ALL_THEMES: readonly string[];
  THEME_MODES: readonly ['light', 'dark', 'system'];
  resolveLocale: (locale: string | undefined, navigatorLanguage: string, locales: VditorDesktopLocales) => SupportedLocale;
  translate: (locales: VditorDesktopLocales, currentLocale: SupportedLocale, key: string, params?: Record<string, string | number>) => string;
  formatIpcErrorMessage: (error: unknown, locales: VditorDesktopLocales, currentLocale: SupportedLocale) => string;
  IPC_ERROR_MESSAGE_KEYS: Record<string, string>;
  resolveEffectiveTheme: (settings: ThemeSettings, systemTheme: string) => AppTheme;
  resolveThemeMode: (settings: ThemeSettings) => ThemeMode;
  validateDarkTheme: (theme: string) => AppTheme;
  validateLightTheme: (theme: string) => AppTheme;
  getPreferredCodeTheme: (settings: ThemeSettings, dark: boolean) => string;
  resolveContentTheme: (settings: ThemeSettings, dark: boolean) => string;
}
```

### 类型声明

```typescript
// src/renderer/types/bridges.d.ts
interface Window {
  appAPI: AppAPI;
  fileAPI: FileAPI;
}

// src/renderer/types/locales.d.ts
type SupportedLocale = 'en_US' | 'zh_Hans' | 'zh_Hant';
type VditorDesktopLocales = Readonly<Record<SupportedLocale, LocaleDictionary>>;

// src/renderer/types/adapter.d.ts
interface Window {
  VditorDesktopAdapter: VditorDesktopAdapter;
}

// src/renderer/ui/theme.ts
export type AppTheme = 'dark' | 'claude-dark' | 'monokai-pro-dark' | 'classic' | 'claude-light' | 'monokai-pro-light';
export type ThemeMode = 'light' | 'dark' | 'system';

// src/renderer/ui/theme-controller.ts
export interface ThemeSettings {
  theme: string;
  systemTheme: boolean;
  darkTheme: string;
  lightTheme: string;
  codeTheme: string;
  darkCodeTheme: string;
  lightCodeTheme: string;
  contentTheme: string;
}
```

### Legacy 入口

```javascript
// src/renderer/app.js 末尾
window.__vditorDesktopLegacyBootstrap = init;
```

## 当前 app.js 关键事实

批次 2 迁移后的当前状态：

- **5383 行**单 IIFE（原 5414 行，减少 31 行）
- `state` 对象 12 字段 + 28 模块级 `let` + 3 队列/映射
- 每标签对象 ~44 字段
- 70 次 addEventListener，21 setTimeout，19 rAF
- 4 类 ResizeObserver，2 类 MutationObserver
- 1 个 Vditor 创建点（ensureEditor:1524），3 个销毁点
- 7 个 IPC 事件订阅
- 9 项未解释叠加路径（详见基线文档 §5）

**已迁移到 TypeScript 的函数**：

- `escapeHTML`、`fileName`、`stripExtension` → `src/renderer/utils/strings.ts`
- `detectLineEnding` → `src/renderer/utils/line-ending.ts`
- `isDarkTheme`、`DARK_THEMES`、`LIGHT_THEMES`、`ALL_THEMES`、`THEME_MODES` → `src/renderer/ui/theme.ts`
- `resolveLocale`、`t`（→`translate`）、`ipcErrorMessage`（→`formatIpcErrorMessage`）、`IPC_ERROR_MESSAGE_KEYS` → `src/renderer/ui/localization.ts`
- `darkThemePreference`（→`validateDarkTheme`）、`lightThemePreference`（→`validateLightTheme`）、`preferredCodeTheme`（→`getPreferredCodeTheme`）、`themeModeFromSettings`（→`resolveThemeMode`） → `src/renderer/ui/theme-controller.ts`

**仍在 app.js 中的主要函数**（按域分类）：

- **notifications/dialogs**：`showMessage`、`showTemporaryDocumentNotice`、`showConfirmDialog`、`showUnsavedDialog`、`confirmDialog`、`closeConfirmDialog`、`setConfirmDialogDraggable`
- **主题 DOM 操作**：`applyTheme`、`syncThemeModeControl`、`selectStatusThemeMode`、`syncCodeThemeSelect`、`syncCodeThemeMenus`、`syncCodeThemeControls`、`syncContentThemeHosts`、`resolveTheme`
- **文档/标签**：`activeTab`、`openDocument`、`saveDocument`、`closeTab`、`newUntitled` 等
- **编辑器**：`ensureEditor`、`editorOptions`、`rebuildEditor` 等
- **工作区**：`restoreWorkspace`、`refreshFileTree` 等
- **设置**：`openSettings`、`saveSettings`、`applyPresentationSettings` 等

## 构建现状

- `build:main`：`tsconfig.main.json` 编译 main process TypeScript
- `build:renderer`：`scripts/build-renderer.js` 使用 esbuild 打包两个入口：
  - `src/renderer/main.ts` → `dist/renderer/main.js`（IIFE，~13KB dev）
  - `src/renderer/pure-functions.ts` → `dist/renderer/pure-functions.js`（IIFE，~5.5KB dev，`globalName: '__vditorDesktopPureFunctions'`）
- `build:assets`：将 `src/renderer/*`（跳过 `.ts`）和 Vditor 资产复制到 `dist/`
- `npm run build` = `build:main` + `build:renderer` + `build:assets`
- `check` = `format:check` + `check:project` + `lint` + `typecheck` + `typecheck:renderer` + `check:vditor` + `npm test` + `npm run build`
- `check:all` = `check` + `test:e2e`

## 下一步行动

### 优先级建议

1. **先完成批次 2 剩余工作**（CSS 主题拆分、notifications/dialogs），因为：
   - 不触碰状态层，与批次 3 无代码冲突
   - 规模可控，可在 Session 前半段完成
   - 完成后批次 2 可标记为"已完成"

2. **再推进批次 3**（AppStore 与文档状态模型），因为：
   - 是 0.2.5 最关键的架构基础
   - 需要大量上下文，放在 Session 后半段专注处理
   - 如果批次 2 剩余工作遇到阻塞（如 CSS computed-style 对比发现问题），先记录不纠缠，优先推进批次 3

### 具体步骤

1. 阅读 `docs/14-0.2.5-RENDERER-REFACTOR-PLAN.md` 的标题、§4（共同原则）、§6.1（主题样式组织）、§7-9（状态模型）和 §17（阶段 3）
2. 阅读 `docs/01-CODE-STRUCTURE.md` 标题和当前批次相关章节，定位实际代码
3. 阅读 `docs/04-THEMES.md` 了解六套主题的现有结构
4. 阅读 `docs/05-FILE-SAFETY.md` 了解文件安全契约（批次 3 需要理解 identity 概念）
5. 按优先级推进，每步验证后继续

**重要提醒**：

- 批次 2 剩余工作不改变任何主题的最终计算样式
- 批次 3 不迁移保存/打开/关闭的用例实现（批次 4）；不迁移 Vditor 生命周期（批次 5）
- 六套主题的最终计算样式必须保持不变
- 状态所有权表是批次 3 的核心交付物，必须清晰记录每个状态域的 source of truth、唯一业务写入者、公开命令和只读消费者
