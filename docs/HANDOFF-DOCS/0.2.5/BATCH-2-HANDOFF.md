# 批次 2 交接文档

> 写给新 Session 的 Agent，启动 0.2.5 批次 2：纯函数与基础 UI 域迁移。

## 项目概况

- **仓库**：`/home/shawnzhang/Projects/Vditor-Electron`
- **分支**：`dev-0.2.5`
- **版本**：0.2.0 已发布（`v0.2.0` tag = `bfaf25a`）；当前开发 0.2.5（渲染层架构重构）
- **环境**：Fedora Workstation Linux，`DISPLAY=:0`，E2E 可正常运行（无容器/沙箱限制）
- **参考 worktree**：`../Vditor-Electron-0.2.0-reference`（detached @ `bfaf25a`，批次 11 前保持不动）

## 批次 1 完成情况

批次 1（Renderer TypeScript 构建管线与组合入口）已完成，`check:all` 全量通过（212 单元 + 142 E2E = 354 条测试），用户手测通过。主要交付物：

| 交付物                   | 位置                            | 说明                                                                                     |
| ------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------- |
| esbuild 构建脚本         | `scripts/build-renderer.js`     | 将 `src/renderer/main.ts` 打包为 `dist/renderer/main.js`（IIFE，8.3KB dev / 1.3KB prod） |
| renderer TypeScript 配置 | `tsconfig.renderer.json`        | strict 模式，ES2022，DOM lib，noEmit                                                     |
| 组合入口                 | `src/renderer/main.ts`          | 验证全局 API → LifecycleManager → LegacyAppController → beforeunload dispose             |
| 核心模块                 | `src/renderer/core/`            | controller.ts、disposables.ts、dom.ts、lifecycle.ts                                      |
| 类型声明                 | `src/renderer/types/`           | bridges.d.ts、vditor.d.ts、adapter.d.ts、locales.d.ts                                    |
| 共享契约骨架             | `src/shared/contracts/index.ts` | ResultCode、WriteResult、DocumentIdentity、FileListItem                                  |
| 新增 npm 脚本            | `package.json`                  | `build:renderer`、`typecheck:renderer`，已纳入 `build` 和 `check`                        |
| 25 条新单元测试          | `tests/unit/renderer/`          | dom（7）、lifecycle（8）、disposables（10）                                              |

**验证结果**（批次 1 实际跑过的）：

- `format:check` ✓ / `lint` ✓ / `typecheck` ✓ / `typecheck:renderer` ✓ / `build` ✓ / `check:vditor` ✓
- `npm test`：21 文件 212/212 通过
- `npm run check:all`：212/212 单元 + 142/142 E2E 全部通过（3.9 分钟）

**关键架构变化**：

- `src/renderer/app.js` 不再自动初始化，改为 `window.__vditorDesktopLegacyBootstrap = init;`
- `src/renderer/main.ts` 作为组合入口控制启动时机
- `index.html` 脚本加载顺序：Vditor → locales.js → vditor-adapter.js → app.js → main.js
- `dist/` 不含 `.ts` 源码（copy-vditor-assets.js 已跳过）

## 批次 2 施工卡要点

摘自 `docs/15-0.2.5-EXECUTION-TRACKER.md` §6：

> **目标**：对应计划第 4、6.1、16 节。迁移低风险、易测试的纯函数与基础 UI，并完成六套主题样式的职责拆分。

**有序子步骤**：

1. **迁移纯函数**：文件名与扩展名处理、行尾识别、HTML 转义、主题判定与偏好选择、中间省略计算、工具栏模式等纯状态转换；每组迁移按"加单测 → 替换调用 → 删除旧定义 → 验证"执行，不保留双份实现。
2. **迁移 localization、notifications、dialogs** 为独立控制器/模块，补齐行为测试。
3. **建立 ThemeController**：主题枚举、亮暗偏好、`data-theme` 与 Vditor theme 参数。
4. **逐主题迁移 CSS**：先记录六套主题的 computed-style 与关键交互基线，一次迁移一个主题的变量和专属覆盖到 `styles/themes/`，保留语义变量（`--sidebar-surface`、`--editor-surface`、`--accent` 等），验证后删除 `app.css` 对应旧规则；Monokai 内容可读性与 H1-H6 颜色历史特例单独标记。
5. **主题文件组合方式**（`@import`、构建合并或 bundler）必须用构建检查和 E2E 验证最终产物，不只验证源码目录。
6. **将本域相关的 `renderer-shell.test.ts` 源码字符串检查替换为行为测试**。

**不包含**：不迁移状态、文档、编辑器域；不改变任何主题的最终计算样式；不新增主题。

**必须证明**：

- 每个纯函数有单元测试
- 设置、状态栏开关、系统主题切换和三种编辑模式下主题无回归
- 离线资源路径、构建产物和 CSS 顺序稳定
- 组件未重新硬编码主题颜色
- 本域不再有源码字符串测试作为唯一证据

**用户手测重点**：逐一切换六套主题、三种编辑模式和三种工具栏，与批次 0 基准截图对比；修改语言确认文案无缺失。

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

## 批次 1 遗留的关键接口

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
```

### Legacy 入口

```javascript
// src/renderer/app.js 末尾
window.__vditorDesktopLegacyBootstrap = init;
```

## 当前 app.js 关键事实

从 `docs/16-0.2.5-BASELINE-BEHAVIOR.md` 摘要：

- 5414 行单 IIFE，231 函数声明
- `state` 对象 12 字段 + 28 模块级 `let` + 3 队列/映射
- 每标签对象 ~44 字段
- 70 次 addEventListener，21 setTimeout，19 rAF
- 4 类 ResizeObserver，2 类 MutationObserver
- 1 个 Vditor 创建点（ensureEditor:1524），3 个销毁点
- 7 个 IPC 事件订阅
- 9 项未解释叠加路径（详见基线文档 §5）

## 构建现状

- `build:main`：`tsconfig.main.json` 编译 main process TypeScript
- `build:renderer`：`scripts/build-renderer.js` 使用 esbuild 打包 renderer TypeScript
- `build:assets`：将 `src/renderer/*`（跳过 `.ts`）和 Vditor 资产复制到 `dist/`
- `npm run build` = `build:main` + `build:renderer` + `build:assets`
- `check` = `format:check` + `check:project` + `lint` + `typecheck` + `typecheck:renderer` + `check:vditor` + `npm test` + `npm run build`
- `check:all` = `check` + `test:e2e`

## 下一步行动

1. 阅读 `docs/14-0.2.5-RENDERER-REFACTOR-PLAN.md` 的标题、§4（共同原则）、§6.1（主题样式组织）和 §16（阶段 2）
2. 阅读 `docs/01-CODE-STRUCTURE.md` 标题和当前批次相关章节，定位实际代码
3. 阅读 `docs/04-THEMES.md` 了解六套主题的现有结构
4. 按子步骤推进，每步验证后继续

**重要提醒**：本批次迁移纯函数和基础 UI 域，不迁移状态/文档/编辑器域。六套主题的最终计算样式必须保持不变。
