# 开发与发布工作流

本文档定义了 Vditor Desktop 版本开发、评审、打标签、构建与发布的标准工作流。

## 分支模型

- 版本或功能专用的 `dev-*` / `feat-*` 分支是活跃开发分支。例如 `dev-<version>` 承载一个版本的发布工作。
- `main` 以发布为导向，应当通过 GitHub pull request 接收已完成的工作。
- 官方版本标签必须创建在 pull request 合并后的 `main` 最终提交上。

不要在开发分支上创建官方发布标签。开发分支上的提交可能因合并策略而与最终在 `main` 上产生的提交不同。

## 在开发分支上准备发布

在打开 pull request 之前：

1. 完成实现并更新相关测试与文档。
2. 需要时，将 `package.json` 和 `package-lock.json` 更新为新版本。
3. 在 `CHANGELOG.md` 中添加新版本章节。
4. 当安装方式或用户可见行为发生变化时，更新面向产品的文档。
5. 运行必要的本地验证（格式化、lint、类型检查、Vditor 一致性检查、单元测试、构建以及适用的 Electron E2E 测试），具体命令见下表。
6. 项目文档管理：根据最新代码状态更新 `CHANGELOG.md` 及 `docs/` 中的其他文档。新发现的技术债、架构风险和改进建议记入 `docs/00-ISSUES.md`（长期条目的唯一存放处，`01-CODE-STRUCTURE.md` 不再维护这类清单）。对于安全敏感的发布，还应视情况校对 `docs/01-CODE-STRUCTURE.md`、执行追踪器、`docs/06-FILE-SAFETY.md` 和 `docs/04-CROSS-PLATFORM.md`。
7. 将就绪的发布变更提交到开发分支并推送。

本地验证命令（定义于 `package.json` 的 `scripts`）：

| 命令 | 用途 |
| --- | --- |
| `npm run check` | 聚合检查：`format:check`、`check:project`、`lint`、`typecheck`、`typecheck:renderer`、`check:vditor`、`test`、`build` |
| `npm run check:all` | 在 `check` 基础上追加 `test:e2e` 的完整自动化检查 |
| `npm run typecheck:renderer` | 单独执行渲染进程 strict TypeScript 检查 |
| `npm run test:e2e` | 单独执行 Electron Playwright E2E（先运行 `build`） |

`AGENTS.md` 要求：迭代期间使用最小充分验证即可，但在合并影响双进程或渲染外壳的功能之前必须运行 `npm run check:all`。

保持发布准备变更在 pull request 中可评审，避免在发布标签创建之后修改源文件。

## 环境与测试基础设施

- Node.js 版本约束由 `package.json` 的 `engines` 定义：`^22.22.2 || ^24.15.0 || >=26.0.0`；CI（`.github/workflows/quality.yml`）实际使用 Node 24.15.0。
- 单元/集成测试使用 Vitest 4.1.11；Electron E2E 使用 `@playwright/test`（`^1.62.1`）。
- `package.json` 的 `overrides` 将 `electron-builder` 的传递依赖 `js-yaml` 固定为 4.3.2，对应 0.2.6 批次修复的 Dependabot 安全公告；除非确认该传递依赖已升级到不受影响的版本，否则不要在依赖升级时移除此 override。

## Electron E2E 失败判定

- Electron E2E 因执行环境限制而无法启动（例如沙箱禁止 Chromium 单实例 socket）时，报告为环境限制，不算应用测试失败。
- 只有断言实际执行且失败，才判定为应用失败；启动失败不等于测试失败。
- 不得用单元测试静默替代 E2E 用例。GUI/Electron E2E 可能需要在正常沙箱之外执行。

## Pull request 与合并

从发布分支（如 `dev-<version>`）向 `main` 创建 pull request。评审 diff 并确认所需检查通过。使用项目选定的 GitHub 合并策略合并 pull request。

所需检查由 `.github/workflows/quality.yml` 提供：在向 `main` 的 push 与 pull request 上执行 `npm ci`、`format:check`、`check:project`、`lint`、`build:renderer`、main/renderer typecheck、`check:vditor` 与单元测试。该 workflow 是 0.2.5 批次 10 建立的 CI gate，只做质量验证，不发布、不签名，也不打包 Windows/macOS；Electron E2E 与发布打包仍在本地执行。

发布提交是 `main` 上产生的提交：

- 使用合并提交（merge commit）时，是合并提交本身；
- 使用 squash 合并时，是 squash 提交；
- 使用 rebase 合并时，是最终 rebase 后的提交。

## 创建 GitHub release

pull request 合并之后：

1. 打开 GitHub 的 **New release** 页面。
2. 使用仓库既定的标签约定创建一个新标签，格式统一为 `v<version>`（如 `v0.2.5`）。0.1.x 时期的历史标签没有 `v` 前缀，自 `v0.2.0` 起统一为 `v<version>`，新标签必须遵循该格式。
3. 将标签目标设置为 `main` 上最终合并后的提交。
4. 填写发布标题，并将 `CHANGELOG.md` 中对应的版本章节复制到 release notes 中。
5. 将 release 保存为草稿。

标签必须在构建发布包之前创建，使产物与 `main` 上该发布对应的精确提交一致。构建脚本本身不解析 git 标签：`scripts/release-linux.js` 只从 `package.json` 读取 `version` 并用于产物文件名，`scripts/check-project-metadata.js` 校验 `package.json`、lock 文件、README 徽章与 `index.html` 回退版本的一致性，关于页版本来自主进程的 `app.getVersion()`。因此“包版本与发布标签一致”必须由发布前的版本 bump 保证，而不是由构建步骤推导。

## 构建发布产物

同步本地仓库与标签，然后从发布标签构建：

```bash
git fetch origin --tags
git switch --detach v<version>
npm run release:linux
```

将 `v<version>` 替换为实际标签名。`release:linux` 只能在 Linux x86_64 主机上运行，先执行 `scripts/check-project-metadata.js`，再用 `electron-builder --linux dir --x64` 生成未打包的应用目录 `release/linux-unpacked`（始终生成的中间产物），随后产出便携归档 `vditor-desktop-x86_64-<version>-portable.tar.gz` 与 `vditor-desktop-x86_64-<version>-portable.AppImage`。AppImage 使用缓存到 `.cache/appimage-tools` 的 `appimagetool 1.9.1` 与经 SHA-256 校验的 type2 runtime，并以 `--no-appstream` 跳过会拒绝含连字符的稳定反向域应用 ID 的 AppStream 建议校验（ID 本身由 `check:project` 校验）。仅便携归档和 AppImage 有专属的 `release:linux:portable` 与 `release:linux:appimage` 脚本。

`package.json` 的 `build.linux.target` 还声明了 `deb` 与 `rpm`，但当前发布流程不使用它们：只有直接运行 `npm run dist`（`electron-builder` 默认目标）才会生成 deb/rpm，`npm run pack` 则只生成未打包目录供本地冒烟。

在上传之前，请确认：

- 包版本与发布标签一致；
- 关于页面显示的版本符合预期；
- 应用可以启动且主要编辑工作流正常；
- 产物文件名与校验和正确。

将产物上传到草稿 GitHub release。构建之后不要修改源码或移动标签；否则产物将不再与打标签的发布相对应。

## 发布与发布后清理

在产物与说明经过评审后，发布该 GitHub release。然后回到常规开发流程：

```bash
git switch dev-<version>
git pull --ff-only origin dev-<version>
```

在全新的版本或功能专用开发分支上开始后续工作；保持 `main` 与已发布的发布历史一致。若需要发布后的修复，在新的分支上开发并使用新的版本标签，而不是移动已有的发布标签。
