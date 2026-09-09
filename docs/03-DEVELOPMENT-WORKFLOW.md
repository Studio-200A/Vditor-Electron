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
5. 运行必要的检查，包括格式化、lint、类型检查、Vditor 一致性检查、单元测试、构建以及适用的 Electron E2E 测试。
6. 项目文档管理：根据最新代码状态更新 `CHANGELOG.md` 及 `docs/` 中的其他文档。对于安全敏感的发布，还应视情况校对 `docs/01-CODE-STRUCTURE.md`、执行追踪器、`docs/06-FILE-SAFETY.md` 和 `docs/04-CROSS-PLATFORM.md`。
7. 将就绪的发布变更提交到开发分支并推送。

保持发布准备变更在 pull request 中可评审，避免在发布标签创建之后修改源文件。

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
2. 使用仓库既定的标签约定创建一个新标签，如 `<version>` 或 `v<version>`。
3. 将标签目标设置为 `main` 上最终合并后的提交。
4. 填写发布标题，并将 `CHANGELOG.md` 中对应的版本章节复制到 release notes 中。
5. 将 release 保存为草稿。

标签必须在构建发布包之前创建。这使构建元数据生成器能够将标签解析为该发布所代表的精确提交。

## 构建发布产物

同步本地仓库与标签，然后从发布标签构建：

```bash
git fetch origin --tags
git switch --detach v<version>
npm run release:linux
```

将 `v<version>` 替换为实际标签名。该命令生成配置好的 Linux 发布产物，包括未打包的应用、便携归档和 AppImage。若只需要某一个产物，使用对应的 `release:linux:*` 脚本。

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
