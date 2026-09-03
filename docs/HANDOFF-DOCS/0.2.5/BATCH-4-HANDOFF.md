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
- 批次 3 的类型定义和 AppStore 已建立；批次 4 已将文档集合和 active document ID 接入 Store，`app.js` 仅保留组合入口兼容访问

## 批次 4 施工卡（当前工作树）

摘自 `docs/15-0.2.5-EXECUTION-TRACKER.md` §6：

> **目标**：对应计划第 4.1、17、18 节。把文档域从 `app.js` 迁入 `documents/`，完整保留 0.2.0 文件安全契约。这是安全敏感度最高的批次，严格按子步骤推进并逐步验证。

**有序子步骤**：

1. **TabController**：标签渲染、活动标签切换（只管表现，不读写磁盘）。
2. **新建和打开文件**：当前内容读取。
3. **保存、另存和自动保存**：建立 identity-aware 保存队列和命令边界；Vditor 正文读取、timer 与交易调用的 runtime 协调归批次 5。
4. **关闭文档与未保存确认**：固定确认 → runtime 释放 → Store 删除顺序；具体 runtime 清理和 editor UI 收敛归批次 5。
5. **外部变化和冲突**：完成 identity-aware 分类；更新 Vditor 和 editor-owned UI 的实际提交归批次 5。
6. **session 与 recovery 接入快照 DTO**：恢复正文注入和 recovery UI 协调归批次 5。
7. **测试迁移**：将本域相关的源码字符串测试替换为行为测试，补齐 watcher ready/reconciliation、identity 别名、基线一致性的聚焦测试。

**不包含范围**：不迁移 Vditor 实例管理、editor runtime 内容读写、自动保存 timer、恢复 UI 或 editor 相关 UI 协调（批次 5）；不改变冲突动作的 UI 文案与流程；不扩大后台文件保护范围。

**必须证明（安全回归，缺一不可）**：

- 文档所有权、去重、冲突、不可用和 watcher 释放/重绑均以 canonical identity 为准；路径别名不绕过任何保护。
- watcher 生命周期保持"创建 → ready → 单次磁盘 reconciliation → 实时事件"；ready 前事件与重绑空窗由补偿读取覆盖；generation/revision 过期保护有效。
- 保存基线正文与 `expectedBytes` 来自同一次原始读取；基线后的外部变化不能被第二次读取"洗成"安全基线。
- 异步打开、保存、恢复和外部变化结果提交前确认文档仍存在且绑定未变；关闭、另存或工作区切换后的迟到结果不修改新状态。
- 冲突期间自动保存暂停、外部删除不静默重建、`unchanged`/`changed`/`unavailable` 恢复分支行为不变。

**用户手测重点**：按 `docs/05-FILE-SAFETY.md` 的用户路径逐项对比：普通保存、另存、自动保存、外部修改四种动作、外部删除与重新出现、异常退出恢复。

### 当前实施状态（2026-09-03）

- `TabController` 已接入 `app.js`，只拥有标签栏 DOM、点击/中键关闭/拖拽和活动标签滚动；`renderTabs()` 仅投影 `TabViewModel`，其拖拽 reset timer 会在 controller dispose 时取消。
- `AppStore` 已作为文档集合和活动文档 ID 的 source of truth；`state.tabs` / `state.activeId` 只保留组合入口兼容访问，集合、激活和排序通过 Store 受控 API 完成。
- `DocumentController` 已接管新建、canonical identity-aware 打开、当前正文读取，并组合保存队列、关闭顺序和外部变化分类；打开流程同时保留未命名标签的目标路径碰撞保护，`saveTab()`、`closeTab()` 和 watcher 正文分类均经其命令入口进入。
- session 已使用 `src/shared/contracts/session.ts` 定义的 schema v1 DTO，兼容读取无版本旧配置；recovery 使用 schema v2 DTO。DOM、Vditor、observer、timer 和队列句柄不跨持久化边界。
- 已新增真实 `AppStore` + controllers + fake bridge/Vditor 集成测试，并删除本域 `renderer-shell.test.ts` 中依赖 `app.js` 源码字符串的断言；剩余源码字符串断言属于其他尚未迁移域。
- `performSaveTab()` 的 Vditor 正文读取与交易调用、自动保存 timer、外部事件的 editor UI 提交、recovery UI、多数关闭 runtime 清理和 `switchTab()` 的 editor 组合仍在 `app.js` 过渡回调；这些已正式归属批次 5 的 EditorController 收口。批次 4 保留 DocumentController 的命令入口、identity 和安全语义，不建立第二条文件生命周期。
- 因此批次 4 的代码交付已完成；重新出现文件的确认重建手测也已通过。它保持“待手测”仅等待一次无失败的完整 E2E 运行，不表示仍有批次 4 的开发任务。

**当前聚焦验证：** `typecheck`、`typecheck:renderer`、`format:check`、`lint`、`check:vditor`、`build` 全部通过；批次 4 相关单元测试 12 文件 135/135 通过；自动保存、恢复、identity 合并、别名 Save As、冲突、删除/重现的 renderer 生命周期 E2E 6/6 通过。用户曾取得一次 373/373 单测与 142/142 E2E 的干净 `check:all`；重新出现文件确认重建修复后，受影响删除/重现场景 E2E 1/1 和手测均通过。修复后的 `check:all` 为 373/373 单测及非 E2E gate 通过、141/142 E2E，通过后单项重跑显示 editor-mode 大纲导航用例 flaky；仍待一次无失败的完整 E2E 运行。

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
  setActiveDocument(id: string | null): void;
  moveDocument(id: string, beforeId: string, placeAfter: boolean): void;
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

批次 4 的 settings session 边界另由 `src/shared/contracts/session.ts` 的 schema v1 `SessionSnapshot` 与 `src/renderer/documents/session-snapshot.ts` 白名单投影/验证负责；recovery IPC 使用 `src/renderer/documents/recovery-snapshot.ts` 的 schema v2 DTO。旧的无版本 session 配置只在读取时兼容归一化，未知版本拒绝。

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

批次 4 当前工作树状态：

- **5244 行**单 IIFE；文档域已通过组合入口接入 Store 与 TypeScript 控制器，其他域仍在 legacy IIFE
- `state` 对象保留应用壳层字段，文档集合和活动 ID 改由 `AppStore` 提供；资源/设置/恢复异步链仍由组合入口协调
- 每标签对象 ~44 字段（包含运行时属性如 vditor、host、toolbar 等）
- 60 次 addEventListener，18 setTimeout，16 rAF
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
- 标签栏表现与交互 → `src/renderer/documents/tab-controller.ts`
- 新建、identity-aware 打开和正文读取 → `src/renderer/documents/document-controller.ts`
- 文档/identity 两级保存队列 → `src/renderer/documents/document-save-controller.ts`
- 关闭确认后的 runtime 释放、Store 删除顺序 → `src/renderer/documents/document-close-controller.ts`
- watcher 正文状态分类 → `src/renderer/documents/external-change-controller.ts`
- recovery/session 白名单 DTO → `src/renderer/documents/recovery-snapshot.ts`、`session-snapshot.ts` 与 `src/shared/contracts/session.ts`

**仍在 app.js 中的主要函数**（按域分类）：

- **文档/标签过渡组合**：`activeTab`、`createTab`、`openPaths`、`openPath`、`switchTab`、`closeTab`、`renderTabs`、`saveTab`、`performSaveTab` 等；其中打开/新建、标签表现、保存排队、关闭顺序和外部分类已由上述控制器拥有入口
- **编辑器**：`ensureEditor`、`editorOptions`、`rebuildEditor`、`synchronizeVditorMode` 等
- **主题 DOM 操作**：`applyTheme`、`syncThemeModeControl`、`selectStatusThemeMode`、`syncCodeThemeSelect`、`syncCodeThemeMenus`、`syncCodeThemeControls`、`syncContentThemeHosts`、`resolveTheme`
- **工作区**：`setWorkspace`、`refreshFileTree`、`restoreWorkspace` 等
- **设置**：`openSettings`、`saveSettings`、`applyPresentationSettings` 等
- **外部变化**：`handleExternalChange`、`reloadExternalChange`、`ignoreExternalChange` 等
- **恢复**：`restoreRecoverySnapshots`、`discardRecoverySnapshot`、`saveRecoveredVersion` 等

**关键数据结构**：

app.js 中的 tab 对象（当前仍以扁平属性访问 runtime；EditorController 迁移时再统一为 store 的 `DocumentTab.runtime`）：

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
  mode,
  // 当前 legacy 组合仍以扁平属性访问 runtime
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
  - `src/renderer/main.ts` → `dist/renderer/main.js`（IIFE，当前构建约 8.4KB）
  - `src/renderer/pure-functions.ts` → `dist/renderer/pure-functions.js`（IIFE，当前构建约 138.1KB，`globalName: '__vditorDesktopPureFunctions'`）
- `build:assets`：将 `src/renderer/*`（跳过 `.ts`）和 Vditor 资产复制到 `dist/`
- `npm run build` = `build:main` + `build:renderer` + `build:assets`
- `check` = `format:check` + `check:project` + `lint` + `typecheck` + `typecheck:renderer` + `check:vditor` + `npm test` + `npm run build`
- `check:all` = `check` + `test:e2e`

## 下一步行动

### 当前交接动作

1. 用户已完成重新出现文件横幅“重新创建文件”确认路径的复测；下一次完整 E2E 运行需确认 `editor-modes.spec.ts` 的大纲导航用例不再 flaky，取得无失败结果后方可关闭批次 4。
2. 若用户发现当前 HEAD 的行为回归，先保留失败输出，再按 `docs/05-FILE-SAFETY.md` 对应契约定位；不得用单项重跑替代全量结果。
3. 用户全量验证批次 4 后进入批次 5：将 `ensureEditor`、`rebuildEditor`、runtime 句柄、自动保存 timer、编辑器内容读写，以及批次 4 文档命令的 runtime/UI 协调迁移到 `EditorController`，然后把 `app.js` 的过渡回调缩窄为组合层。
4. 批次 5 迁移时继续保持 `DocumentController` 的命令入口、`TabController` 的纯表现边界、canonical identity 和 generation/revision 保护；不要把 Vditor 私有 DOM 查询扩散到文档域。
5. 每次结构变化后同步更新 `docs/15-0.2.5-EXECUTION-TRACKER.md`、`docs/01-CODE-STRUCTURE.md` 和 `CHANGELOG.md`，并只运行与改动匹配的聚焦验证。

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
