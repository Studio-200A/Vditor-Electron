# 批次 4 交接文档

> 写给新 Session 的 Agent，启动 0.2.5 批次 4（文档与标签生命周期迁移）。

## 项目概况

- **仓库**：`/home/shawnzhang/Projects/Vditor-Electron`
- **分支**：`dev-0.2.5`
- **版本**：0.2.0 已发布（`v0.2.0` tag = `bfaf25a`）；当前开发 0.2.5（渲染层架构重构）
- **环境**：Fedora Workstation Linux，`DISPLAY=:0`，E2E 可正常运行（无容器/沙箱限制）
- **参考 worktree**：`../Vditor-Electron-0.2.0-reference`（detached @ `bfaf25a`，批次 11 前保持不动）

## 批次 1-3 完成情况

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

### 批次 2：纯函数与基础 UI 域迁移（已完成）

| 交付物                   | 位置                            | 说明                                                                                     |
| ------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------- |
| 字符串纯函数             | `src/renderer/utils/strings.ts` | `escapeHTML`、`fileName`、`stripExtension`                                               |
| 行尾纯函数               | `src/renderer/utils/line-ending.ts` | `detectLineEnding`（返回 `'CRLF' \| 'LF'`）                                          |
| 主题常量与判定           | `src/renderer/ui/theme.ts`      | `DARK_THEMES`、`LIGHT_THEMES`、`ALL_THEMES`、`THEME_MODES`、`isDarkTheme`；导出 `AppTheme`、`ThemeMode` 类型 |
| 本地化纯函数             | `src/renderer/ui/localization.ts` | `resolveLocale`、`translate`、`formatIpcErrorMessage`、`IPC_ERROR_MESSAGE_KEYS`          |
| 主题控制器纯函数         | `src/renderer/ui/theme-controller.ts` | `resolveEffectiveTheme`、`resolveThemeMode`、`validateDarkTheme`、`validateLightTheme`、`getPreferredCodeTheme`、`resolveContentTheme` |
| CSS 主题拆分             | `src/renderer/styles/themes/`   | 5 个主题 CSS 文件（dark、claude-light、claude-dark、monokai-pro-light、monokai-pro-dark）；classic 保留在 app.css 的 `:root` 中 |
| 主题切换机制             | `src/renderer/index.html` + `app.js` | 5 个 `<link>` 标签，使用 `disabled` 属性控制启用/禁用；`applyTheme()` 切换 `disabled` 属性 |
| Notifications 控制器     | `src/renderer/ui/notifications.ts` | `NotificationsController` 类，封装 showMessage、showTemporaryDocumentNotice、showConfirmDialog、closeConfirmDialog、confirmDialog、showUnsavedDialog、setConfirmDialogDraggable、setupConfirmDialogDrag |
| 纯函数 bundle 入口       | `src/renderer/pure-functions.ts` | esbuild 入口，打包为 `dist/renderer/pure-functions.js`，暴露 `window.__vditorDesktopPureFunctions` |
| 79 条新单元测试          | `tests/unit/renderer/`          | strings（16）、line-ending（5）、theme（12）、localization（15）、theme-controller（15）、notifications（21） |

**验证结果**（批次 1-2 实际跑过的）：

- `format:check` ✓ / `lint` ✓ / `typecheck` ✓ / `typecheck:renderer` ✓ / `build` ✓ / `check:vditor` ✓
- `npm test`：27 文件 291/291 通过（原 212 + 新增 79）
- `npm run check:all`：291/291 单元 + 142/142 E2E = 433 条全部通过（用户手测确认）

### 批次 3：AppStore 与文档状态模型（已完成）

| 交付物                   | 位置                            | 说明                                                                                     |
| ------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------- |
| 核心状态类型             | `src/renderer/state/types.ts`   | `EditMode`、`DocumentIdentity`、`DocumentState`、`EditorRuntime`、`DocumentTab`、`ExternalConflict`、`ExternalFileState`、`RecoveryState`、`AppState`、`AppSettings` |
| AppStore 实现            | `src/renderer/state/store.ts`   | 受控修改 API（addDocument、removeDocument、activateDocument、updateDocument、updateDocumentRuntime 等）、查询 API（getDocument、getActiveDocument、getState）、订阅机制（subscribe、subscribeWithSelector） |
| 快照投影函数             | `src/renderer/state/snapshots.ts` | `toSessionSnapshot`、`toRecoverySnapshot`、`restoreDocumentState`、`restoreRecoveryState`；版本化、可序列化、运行时句柄不进入快照 |
| 状态所有权表             | `docs/15-0.2.5-EXECUTION-TRACKER.md` §10 批次 3 记录 | 记录每个状态域的 source of truth、唯一业务写入者、公开命令和只读消费者 |
| 52 条新单元测试          | `tests/unit/renderer/state/`    | store.test.ts（35）、snapshots.test.ts（17）                                             |

**验证结果**（批次 3 实际跑过的）：

- `format:check` ✓ / `lint` ✓ / `typecheck` ✓ / `typecheck:renderer` ✓ / `build` ✓ / `check:vditor` ✓
- `npm test`：29 文件 343/343 通过（原 291 + 新增 52）
- `npm run check:all`：待用户手动验证

**关键架构变化**：

- 新增 `src/renderer/state/` 目录，包含类型定义、AppStore 实现和快照投影函数
- AppStore、类型和快照函数通过 `window.__vditorDesktopPureFunctions` 暴露
- `app.js` 中添加了注释，为批次 4 的迁移做准备（尚未实际使用 store）
- 批次 3 的类型定义和 AppStore 已建立，但 app.js 中的 state 对象和 activeTab() 等函数尚未迁移到 store

## 批次 4 施工卡

摘自 `docs/15-0.2.5-EXECUTION-TRACKER.md` §6：

> **目标**：对应计划第 4.1、17、18 节。把文档域从 `app.js` 迁入 `documents/`，完整保留 0.2.0 文件安全契约。这是安全敏感度最高的批次，严格按子步骤推进并逐步验证。

**有序子步骤**：

1. **TabController**：标签渲染、活动标签切换（只管表现，不读写磁盘）。
2. **新建和打开文件**：当前内容读取。
3. **保存、另存和自动保存**：单次磁盘快照映射为解码正文与 `expectedBytes` 后交给安全写入器；结果通过明确返回值/领域错误表达。
4. **关闭文档与未保存确认**：先协调 EditorController（或过渡期现有编辑器接口）释放运行时资源，再从 store 删除。
5. **外部变化和冲突**：外部删除/重新出现/不可读。
6. **session 与 recovery 接入快照 DTO**。
7. **测试迁移**：将本域相关的源码字符串测试替换为行为测试，补齐 watcher ready/reconciliation、identity 别名、基线一致性的聚焦测试。

**不包含范围**：不迁移 Vditor 实例管理本体（批次 5）；不改变冲突动作的 UI 文案与流程；不扩大后台文件保护范围。

**必须证明（安全回归，缺一不可）**：

- 文档所有权、去重、冲突、不可用和 watcher 释放/重绑均以 canonical identity 为准；路径别名不绕过任何保护。
- watcher 生命周期保持"创建 → ready → 单次磁盘 reconciliation → 实时事件"；ready 前事件与重绑空窗由补偿读取覆盖；generation/revision 过期保护有效。
- 保存基线正文与 `expectedBytes` 来自同一次原始读取；基线后的外部变化不能被第二次读取"洗成"安全基线。
- 异步打开、保存、恢复和外部变化结果提交前确认文档仍存在且绑定未变；关闭、另存或工作区切换后的迟到结果不修改新状态。
- 冲突期间自动保存暂停、外部删除不静默重建、`unchanged`/`changed`/`unavailable` 恢复分支行为不变。

**用户手测重点**：按 `docs/05-FILE-SAFETY.md` 的用户路径逐项对比：普通保存、另存、自动保存、外部修改四种动作、外部删除与重新出现、异常退出恢复。

## 关键技术约束（摘自 AGENTS.md）

- Vditor 保持 **3.11.3**，不修改 vendored 文件
- `contextIsolation: true` + `nodeIntegration: false` 保持不变
- preload 只增窄接口，不加通用 IPC 包装
- renderer 不能 import Node 内置模块
- 依赖方向：启动组合层 → 领域控制器 → 基础服务，无循环依赖
- 文件命名：kebab-case；类/接口用 PascalCase；函数/变量用 camelCase
- 代码格式遵循根目录 `.prettierrc.json`，lint 遵循 `eslint.config.mjs`

## 批次 3 遗留的关键接口

### AppStore

```typescript
// src/renderer/state/store.ts
export class AppStore {
  constructor(initialState?: Partial<AppState>);
  getState(): AppState;
  subscribe(subscriber: (state: AppState) => void): () => void;
  subscribeWithSelector<R>(selector: (state: AppState) => R, subscriber: (value: R) => void): () => void;
  
  // Document operations
  addDocument(document: DocumentTab): void;
  removeDocument(id: string): void;
  activateDocument(id: string): void;
  updateDocument(id: string, updates: Partial<DocumentState>): void;
  updateDocumentRuntime(id: string, updates: Partial<EditorRuntime>): void;
  getDocument(id: string): DocumentTab | undefined;
  getActiveDocument(): DocumentTab | null;
  
  // Settings operations
  updateSettings(settings: AppSettings): void;
  updateDefaultSettings(settings: AppSettings): void;
  
  // Locale operations
  updateLocale(locale: SupportedLocale): void;
  
  // Workspace operations
  updateWorkspacePath(path: string): void;
  incrementWorkspaceRevision(): void;
  
  // Toolbar preview operations
  setToolbarPreview(preview: DocumentTab | null): void;
  
  // Untitled counter operations
  incrementUntitledCounter(type: 'file' | 'directory'): number;
  getUntitledCounter(type: 'file' | 'directory'): number;
  
  // External conflict operations
  setExternalConflict(id: string, conflict: ExternalConflict | null): void;
  setExternalFileState(id: string, fileState: ExternalFileState | null): void;
  setExternalChangeIgnored(id: string, ignored: boolean): void;
  
  // Recovery operations
  setRecoveryState(id: string, recoveryState: RecoveryState | null): void;
  incrementRecoveryRevision(id: string): void;
  
  // Content operations
  updateContent(id: string, content: string): void;
  markContentSaved(id: string, savedContent: string): void;
}
```

### 核心类型

```typescript
// src/renderer/state/types.ts
export type EditMode = 'wysiwyg' | 'ir' | 'sv';

export interface DocumentIdentity {
  readonly filePath: string | null;
  readonly fileIdentity: string | null;
}

export interface DocumentState extends DocumentIdentity {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly savedContent: string;
  readonly encoding: string;
  readonly lineEnding: 'CRLF' | 'LF';
  readonly baseDir: string;
  readonly modified: boolean;
  readonly expectedSavedContent: string;
  readonly contentRevision: number;
  readonly mode: EditMode;
  readonly externalConflict: ExternalConflict | null;
  readonly externalChangeIgnored: boolean;
  readonly externalFileState: ExternalFileState | null;
  readonly recoverySnapshotId: string | null;
  readonly recoveryState: RecoveryState | null;
  readonly recoveryRevision: number;
}

export interface EditorRuntime {
  readonly vditor: Vditor | null;
  readonly ready: boolean;
  readonly host: HTMLElement;
  readonly toolbar: HTMLElement | null;
  readonly saveTimer: ReturnType<typeof setTimeout> | null;
  readonly lineObserver: MutationObserver | null;
  readonly lineResizeObserver: ResizeObserver | null;
  readonly lineNumberFrame: number | null;
  readonly whitespaceFrame: number | null;
  readonly bottomSpacerObserver: ResizeObserver | null;
  readonly outlineCollapsed: Set<string>;
  readonly outlineObserver: MutationObserver | null;
  readonly resourceObserver: MutationObserver | null;
  readonly modeShortcutCleanup: (() => void) | null;
  readonly splitResizer: SplitResizer | null;
  readonly recoveryTimer: ReturnType<typeof setTimeout> | null;
  readonly recoveryOperation: Promise<void>;
  readonly pendingAnchor: string;
  readonly pendingEditorContent: boolean;
  readonly saveOperation: Promise<void> | null;
  readonly tableCompositionScrollCleanup: (() => void) | null;
}

export interface DocumentTab extends DocumentState {
  readonly runtime: EditorRuntime;
}

export interface ExternalConflict {
  readonly diskContent: string;
  readonly detectedAt: number;
}

export interface ExternalFileState {
  readonly exists: boolean;
  readonly readable: boolean;
  readonly content: string | null;
}

export interface RecoveryState {
  readonly snapshotId: string;
  readonly content: string;
  readonly mode: EditMode;
}

export interface AppState {
  readonly documents: readonly DocumentTab[];
  readonly activeDocumentId: string | null;
  readonly workspacePath: string;
  readonly settings: AppSettings | null;
  readonly defaultSettings: AppSettings | null;
  readonly locale: SupportedLocale;
  readonly toolbarPreview: DocumentTab | null;
  readonly untitledCounters: {
    readonly file: number;
    readonly directory: number;
  };
  readonly workspaceRevision: number;
  readonly toolbarWrapHeight: number;
}
```

### 快照投影函数

```typescript
// src/renderer/state/snapshots.ts
export const SESSION_SNAPSHOT_VERSION = 1;
export const RECOVERY_SNAPSHOT_VERSION = 1;

export interface SessionDocumentSnapshot {
  readonly version: number;
  readonly id: string;
  readonly filePath: string | null;
  readonly fileIdentity: string | null;
  readonly title: string;
  readonly content: string;
  readonly savedContent: string;
  readonly encoding: string;
  readonly lineEnding: 'CRLF' | 'LF';
  readonly baseDir: string;
  readonly modified: boolean;
  readonly expectedSavedContent: string;
  readonly mode: string;
  readonly recoverySnapshotId: string | null;
}

export interface RecoveryDocumentSnapshot {
  readonly version: number;
  readonly id: string;
  readonly filePath: string | null;
  readonly fileIdentity: string | null;
  readonly title: string;
  readonly content: string;
  readonly savedContent: string;
  readonly encoding: string;
  readonly lineEnding: 'CRLF' | 'LF';
  readonly baseDir: string;
  readonly mode: string;
  readonly recoverySnapshotId: string;
  readonly recoveryState: {
    readonly snapshotId: string;
    readonly content: string;
    readonly mode: string;
  } | null;
}

export function toSessionSnapshot(document: DocumentState): SessionDocumentSnapshot;
export function toRecoverySnapshot(document: DocumentState): RecoveryDocumentSnapshot | null;
export function restoreDocumentState(snapshot: unknown): Omit<DocumentState, 'runtime'> | null;
export function restoreRecoveryState(snapshot: unknown): RecoveryState | null;
```

### 纯函数暴露

```typescript
// window.__vditorDesktopPureFunctions（由 pure-functions.js 暴露）
{
  // 字符串处理
  escapeHTML: (value: unknown) => string;
  fileName: (filePath: string) => string;
  stripExtension: (name: string) => string;
  detectLineEnding: (content: string) => 'CRLF' | 'LF';
  
  // 主题
  isDarkTheme: (theme: string) => boolean;
  DARK_THEMES: readonly ['dark', 'claude-dark', 'monokai-pro-dark'];
  LIGHT_THEMES: readonly ['classic', 'claude-light', 'monokai-pro-light'];
  ALL_THEMES: readonly string[];
  THEME_MODES: readonly ['light', 'dark', 'system'];
  resolveEffectiveTheme: (settings: ThemeSettings, systemTheme: string) => AppTheme;
  resolveThemeMode: (settings: ThemeSettings) => ThemeMode;
  validateDarkTheme: (theme: string) => AppTheme;
  validateLightTheme: (theme: string) => AppTheme;
  getPreferredCodeTheme: (settings: ThemeSettings, dark: boolean) => string;
  resolveContentTheme: (settings: ThemeSettings, dark: boolean) => string;
  
  // 本地化
  resolveLocale: (locale: string | undefined, navigatorLanguage: string, locales: VditorDesktopLocales) => SupportedLocale;
  translate: (locales: VditorDesktopLocales, currentLocale: SupportedLocale, key: string, params?: Record<string, string | number>) => string;
  formatIpcErrorMessage: (error: unknown, locales: VditorDesktopLocales, currentLocale: SupportedLocale) => string;
  IPC_ERROR_MESSAGE_KEYS: Record<string, string>;
  
  // Notifications
  NotificationsController: typeof NotificationsController;
  
  // AppStore
  AppStore: typeof AppStore;
  
  // 快照
  toSessionSnapshot: typeof toSessionSnapshot;
  toRecoverySnapshot: typeof toRecoverySnapshot;
  restoreDocumentState: typeof restoreDocumentState;
  restoreRecoveryState: typeof restoreRecoveryState;
  SESSION_SNAPSHOT_VERSION: number;
  RECOVERY_SNAPSHOT_VERSION: number;
}
```

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

### Legacy 入口

```javascript
// src/renderer/app.js 末尾
window.__vditorDesktopLegacyBootstrap = init;
```

## 当前 app.js 关键事实

批次 3 完成后的当前状态：

- **5281 行**单 IIFE（原 5414 行，减少 133 行）
- `state` 对象 12 字段 + 28 模块级 `let` + 3 队列/映射
- 每标签对象 ~44 字段（包含运行时属性如 vditor、host、toolbar 等）
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
- `showMessage`、`showTemporaryDocumentNotice`、`showConfirmDialog`、`closeConfirmDialog`、`confirmDialog`、`showUnsavedDialog`、`setConfirmDialogDraggable`、`setupConfirmDialogDrag` → `src/renderer/ui/notifications.ts`（NotificationsController 类）

**仍在 app.js 中的主要函数**（按域分类）：

- **文档/标签**：`activeTab`、`createTab`、`openPaths`、`openPath`、`switchTab`、`closeTab`、`renderTabs`、`saveTab`、`performSaveTab` 等
- **编辑器**：`ensureEditor`、`editorOptions`、`rebuildEditor`、`synchronizeVditorMode` 等
- **主题 DOM 操作**：`applyTheme`、`syncThemeModeControl`、`selectStatusThemeMode`、`syncCodeThemeSelect`、`syncCodeThemeMenus`、`syncCodeThemeControls`、`syncContentThemeHosts`、`resolveTheme`
- **工作区**：`setWorkspace`、`refreshFileTree`、`restoreWorkspace` 等
- **设置**：`openSettings`、`saveSettings`、`applyPresentationSettings` 等
- **外部变化**：`handleExternalChange`、`reloadExternalChange`、`ignoreExternalChange` 等
- **恢复**：`restoreRecoverySnapshots`、`discardRecoverySnapshot`、`saveRecoveredVersion` 等

**关键数据结构**：

app.js 中的 tab 对象（批次 4 需要统一为 store 的 DocumentTab 类型）：

```javascript
const tab = {
  id: uid(),
  filePath,
  title,
  content,
  savedContent,
  encoding,
  lineEnding: detectLineEnding(content),
  baseDir,
  modified: content !== savedContent,
  expectedSavedContent,
  fileIdentity,
  contentRevision: 0,
  pendingEditorContent: false,
  saveOperation: null,
  mode,
  // 运行时属性（需要放入 runtime 字段）
  vditor: null,
  ready: false,
  saveTimer: null,
  toolbar: null,
  lineObserver: null,
  lineResizeObserver: null,
  lineNumberFrame: null,
  whitespaceFrame: null,
  bottomSpacerObserver: null,
  outlineCollapsed: new Set(),
  outlineObserver: null,
  resourceObserver: null,
  modeShortcutCleanup: null,
  splitResizer: null,
  externalConflict: null,
  externalChangeIgnored: false,
  externalFileState: null,
  recoverySnapshotId,
  recoveryState,
  recoveryTimer: null,
  recoveryRevision: 0,
  recoveryOperation: Promise.resolve(),
  pendingAnchor,
  host: document.createElement('section'),
};
```

## 构建现状

- `build:main`：`tsconfig.main.json` 编译 main process TypeScript
- `build:renderer`：`scripts/build-renderer.js` 使用 esbuild 打包两个入口：
  - `src/renderer/main.ts` → `dist/renderer/main.js`（IIFE，~13KB dev）
  - `src/renderer/pure-functions.ts` → `dist/renderer/pure-functions.js`（IIFE，~16KB dev，`globalName: '__vditorDesktopPureFunctions'`）
- `build:assets`：将 `src/renderer/*`（跳过 `.ts`）和 Vditor 资产复制到 `dist/`
- `npm run build` = `build:main` + `build:renderer` + `build:assets`
- `check` = `format:check` + `check:project` + `lint` + `typecheck` + `typecheck:renderer` + `check:vditor` + `npm test` + `npm run build`
- `check:all` = `check` + `test:e2e`

## 下一步行动

### 批次 4 实施策略

批次 4 是安全敏感度最高的批次，需要严格按子步骤推进并逐步验证。建议采用以下策略：

1. **渐进式迁移**：不要一次性重写所有文档/标签逻辑，而是按子步骤逐步迁移，每步验证后继续。

2. **结构统一**：首先需要将 app.js 中的 tab 对象结构统一为 store 的 DocumentTab 类型（将运行时属性放入 runtime 字段）。

3. **过渡适配器**：可以创建过渡适配器，让旧代码和新 store 共存，逐步替换。

4. **测试覆盖**：每迁移一个子步骤，都要补充相应的单元测试和集成测试。

5. **安全回归**：特别关注文件安全契约，确保保存基线、冲突检测、watcher 生命周期等行为不变。

### 具体步骤

1. **阅读相关文档**：
   - `docs/05-FILE-SAFETY.md`：了解文件安全契约
   - `docs/14-0.2.5-RENDERER-REFACTOR-PLAN.md` §4.1、§17、§18：了解批次 4 的设计原则
   - `docs/01-CODE-STRUCTURE.md`：了解当前代码结构

2. **创建 TabController 骨架**：
   - 在 `src/renderer/documents/` 目录下创建 `tab-controller.ts`
   - 实现标签渲染和活动标签切换（只管表现，不读写磁盘）
   - 使用 AppStore 管理标签状态

3. **统一 tab 对象结构**：
   - 将 app.js 中的 tab 对象改为符合 DocumentTab 类型
   - 将运行时属性（vditor、host、toolbar 等）放入 runtime 字段
   - 更新所有引用 tab 对象的代码

4. **迁移新建和打开文件**：
   - 将 `createTab`、`openPaths`、`openPath` 等函数迁移到 TabController
   - 使用 store.addDocument() 添加标签
   - 使用 store.activateDocument() 激活标签

5. **迁移保存逻辑**：
   - 将 `saveTab`、`performSaveTab` 等函数迁移到 TabController 或单独的 SaveController
   - 使用 store.updateContent() 和 store.markContentSaved() 更新内容状态
   - 确保保存基线和 expectedBytes 的正确性

6. **迁移关闭逻辑**：
   - 将 `closeTab` 函数迁移到 TabController
   - 使用 store.removeDocument() 删除标签
   - 确保运行时资源正确释放

7. **迁移外部变化和冲突**：
   - 将 `handleExternalChange` 等函数迁移到 TabController
   - 使用 store.setExternalConflict()、store.setExternalFileState() 等更新状态

8. **迁移 session 与 recovery**：
   - 使用快照投影函数（toSessionSnapshot、toRecoverySnapshot）序列化状态
   - 使用恢复函数（restoreDocumentState、restoreRecoveryState）恢复状态

9. **测试迁移**：
   - 将 renderer-shell.test.ts 中的源码字符串测试替换为行为测试
   - 补充 watcher ready/reconciliation、identity 别名、基线一致性的聚焦测试

### 重要提醒

- **不改变用户可观察行为**：批次 4 是架构迁移，不改变任何用户功能
- **文件安全契约必须保持**：保存基线、冲突检测、watcher 生命周期等行为必须与 0.2.0 一致
- **不迁移 Vditor 实例管理**：Vditor 创建/销毁/重建属于批次 5
- **不改变冲突动作的 UI 文案与流程**：只迁移逻辑，不改变 UI
- **迟到结果处理**：异步操作结果提交前必须确认文档仍存在且绑定未变
- **参考 worktree 保持不动**：`../Vditor-Electron-0.2.0-reference` 在批次 11 前保持不动

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
