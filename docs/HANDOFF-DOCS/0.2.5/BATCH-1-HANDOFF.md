# 批次 1 交接文档

> 写给新 Session 的 Agent，启动 0.2.5 批次 1：Renderer TypeScript 构建管线与组合入口。

## 项目概况

- **仓库**：`/home/shawnzhang/Projects/Vditor-Electron`
- **分支**：`dev-0.2.5`
- **版本**：0.2.0 已发布（`v0.2.0` tag = `bfaf25a`）；当前开发 0.2.5（渲染层架构重构）
- **环境**：Fedora Workstation Linux，`DISPLAY=:0`，E2E 可正常运行（无容器/沙箱限制）
- **参考 worktree**：`../Vditor-Electron-0.2.0-reference`（detached @ `bfaf25a`，批次 11 前保持不动）

## 批次 0 完成情况

批次 0（0.2.0 基线冻结）已完成并提交。主要交付物：

| 交付物 | 位置 | 说明 |
|--------|------|------|
| 行为基线文档 | `docs/16-0.2.5-BASELINE-BEHAVIOR.md` | app.js 统计（5414 行/231 函数/12 state 字段/28 模块变量/44 标签字段等）、8 类核心用户路径行为清单、5 组安全状态转换表、16 个迁移域链路图、9 项未解释叠加路径 |
| 基准截图 | `../Vditor-Electron-0.2.5-baseline-screenshots/` | 6 主题 × 3 模式 × 2 工具栏状态 = 36 张（仓库外，不入 Git） |
| 截图采集脚本 | `tmp/screenshots/capture.mjs` | 不入 Git，批次 2 主题迁移后可复用 |
| 3 条回归 E2E | `tests/e2e/editor-modes.spec.ts` + `document-lifecycle.spec.ts` | Vditor 实例保持（模式切换不重建）、工具栏挂载交接、recovery unavailable 分支 |
| Tracker 记录 | `docs/15-0.2.5-EXECUTION-TRACKER.md` §10 | 批次 0 执行记录 |

**验证结果**（批次 0 实际跑过的）：
- `format:check` ✓ / `lint` ✓ / `typecheck` ✓ / `build` ✓ / `check:vditor` ✓
- `npm test`：18 文件 187/187 通过
- 3 条新增 E2E 逐条通过
- **全量 E2E（check:all）未运行**（批次 0 未改 src/，不需要）

## 批次 1 施工卡要点

摘自 `docs/15-0.2.5-EXECUTION-TRACKER.md` §6：

> **目标**：对应计划第 10-13、15 节。先证明新构建管线可用，不同时拆业务；此批次结束时用户行为不变。

**有序子步骤**：

1. 选定并验证轻量 bundler（约束见计划 §10；在 `app://` 协议、MIME、CSP 和打包路径下实测加载行为后提交方案）
2. 新增 `tsconfig.renderer.json`（strict）、`build:renderer`、`typecheck:renderer`，纳入 `npm run build` 与 `check`；资源复制脚本不再复制 `.ts` 源码
3. 建立 `src/renderer/main.ts` 组合入口，将现有 `app.js` 以 legacy 受控方式接入；实现按依赖顺序 init、按相反顺序 dispose 的最小骨架，覆盖部分初始化失败清理测试
4. 建立 `src/renderer/types/`（`window.appAPI`、`window.fileAPI`、`window.VditorDesktopAdapter`、`window.VditorDesktopLocales`、Vditor 用法最小类型）；`src/shared/contracts/` 骨架（仅可序列化 DTO，无运行时依赖）
5. 建立 `requiredElement`/`optionalElement` 类型安全 DOM 辅助
6. 验证开发启动、正式构建和打包后资源路径；更新 Tracker §4 命令表

**必须证明**：
- 打包产物 `index.html` 只加载正式入口且 Vditor/adapter 加载顺序固定
- production 构建不依赖开发服务器
- Vditor vendored 资源未被重复打进 bundle
- renderer 不能 import Node 内置模块
- 部分初始化失败时已注册资源被清理
- `dist/` 不含 `.ts` 源码

**不包含**：不迁移任何业务职责域，不拆分 `app.js` 逻辑，不改变设置默认值或 UI。

**用户手测重点**：用构建产物启动应用，完成一次打开、编辑、保存；确认启动路径无异常。

## 本 Session 工作规则

以下规则由用户明确要求，**必须遵守**：

### 1. 专项测试按需运行

可以运行需要沙箱外权限的专项测试（E2E、构建验证等）。使用以下命令按需选择：

```bash
npm run build                    # 编译 main + 复制 renderer 资产
npm test                         # 单元测试（vitest）
npm run check:vditor             # Vditor 版本锁定检查
npm run format:check             # Prettier 格式检查
npm run lint                     # ESLint
npm run typecheck                # main/preload TypeScript
node scripts/run-electron-e2e.js tests/e2e/<file>.spec.ts -g "<test name>"  # 单条 E2E
```

### 2. 全量测试留给用户手动

**不要运行** `npm run check:all` 或 `npm run check`。全量 E2E 由用户在手动测试阶段运行。

### 3. 代码修改后同步开发文档

每次有实质性代码/结构变化后，同步更新以下文档：

- **`CHANGELOG.md`**：用户可见的行为变化（0.2.5 主要是内部架构变化，用户功能基本不变，但仍需记录重要结构变化）
- **`docs/15-0.2.5-EXECUTION-TRACKER.md`**：批次执行记录（§10），包括实施进度、验证结果、遗留问题
- **`docs/01-CODE-STRUCTURE.md`**：代码架构全景——新增文件/目录/模块时需要更新（批次 1 新增了 `src/renderer/main.ts`、`src/renderer/types/`、`src/shared/contracts/` 等，必须同步）
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
- `build:assets`：将 `src/renderer/*` 原样复制到 `dist/renderer`（renderer 无编译步骤）
- `npm run build` = `build:main` + `build:assets`
- `check` = `format:check` + `lint` + `typecheck` + `check:vditor` + `npm test`
- `check:all` = `check` + `test:e2e`

批次 1 需要新增 `build:renderer` 和 `typecheck:renderer`，并纳入 `build` 和 `check`。

## 下一步行动

1. 阅读 `docs/14-0.2.5-RENDERER-REFACTOR-PLAN.md` 的标题、§4（共同原则）、§10-13（构建管线）和 §15（阶段 1）
2. 阅读 `docs/01-CODE-STRUCTURE.md` 标题和当前批次相关章节，定位实际代码
3. 选定 bundler 方案（约束：离线打包、不进 main/preload、支持 TS strict、与 `app://` 协议/CSP 兼容）
4. 按子步骤推进，每步验证后继续

**重要提醒**：本批次不迁移任何业务逻辑。建立构建管线 + 组合入口骨架 + 类型声明即可。用户行为不变。
