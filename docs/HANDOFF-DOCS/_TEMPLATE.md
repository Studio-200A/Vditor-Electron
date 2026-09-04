# 批次交接文档模板

> **产出位置：** `docs/HANDOFF-DOCS/<版本>/BATCH-<N>-HANDOFF.md`（例如 `0.2.5/BATCH-8-HANDOFF.md`）。
>
> **产物形态：** 复制下方「文档骨架」，用真实信息替换所有 `{{...}}` 占位符，并删除每个小节的 `**编写要求：**` 说明块。`**编写要求：**` 是给你看的指令，不是产物内容。

---

## 一、这个交接文档是干什么的

- **时机**：一个批次结束、即将切换 Session 或 coding agent 时，为下一个 Session 写一份。
- **读者**：下一个 Session 的 agent，**只在启动批次时阅读一次**，之后不再回头读。
- **定位**：只写「接班 agent 启动本批次所需的最小上下文」。它不是长期记录——施工进度、问题、测试证据和状态变更必须只写入 Tracker（`docs/<版本>-EXECUTION-TRACKER.md`），**不要在本文件追加过程记录**。
- **生命周期**：批次结束、内容过期后即删除本文件，只保留 Tracker；本模板永久保留。

## 二、编写前必须先采集信息

写任何一段之前，先跑以下命令 / 读以下文件，确保所有事实可核对：

```bash
git rev-parse --show-toplevel   # 仓库绝对路径
git branch --show-current        # 分支名
git rev-parse HEAD               # 起始提交 hash
git log -1 --oneline             # 起始提交 message
git status --short               # 工作树是否有未提交修改（有则如实记录，不回退）
git tag -l                       # 版本基线 tag
```

然后按顺序读：

1. `AGENTS.md` —— 项目边界与通用约束（交接文档里只引用、不整段复制）。
2. `docs/<版本>-EXECUTION-TRACKER.md` —— 第 5 节（总体路线状态表）、第 6 节（本批次施工卡）、第 10 节（前置批次执行记录）。
3. `package.json` —— 当前版本号。
4. 当前源码（尤其 legacy 入口，如 `src/renderer/app.js`）—— 核对「哪些职责还在这、哪些已迁出」。
5. 相关测试文件与 Tracker 中最近一次全量验证结果。

## 三、编写质量门槛

以下每一项不满足就返回重写：

1. **事实可核对**：commit hash、文件路径、函数名、模块名、测试数必须来自上面的命令或真实源码/Tracker，不得臆造或编造行号。
2. **不复制 AGENTS.md**：通用约束（安全配置、命名规范等）指向 AGENTS.md，不整段粘贴；只在「不可突破的边界」里保留与本批次直接相关的 checklist。
3. **具体而非模糊**：写函数名 / 模块名 / 字段名，不写「相关逻辑」「其他部分」这类空话。
4. **区分「已迁移」与「待迁移」**：明确列出上一批次已完成、本批次不得重做的职责。
5. **测试证据分清来源**：区分「你本次实际运行的专项验证」与「Tracker 记录的用户全量验证」，并注明日期；单条「精确重跑通过」不得写成「全量通过」。
6. **不追加过程记录**：交接文档是「接班人起点快照」，过程痕迹写 Tracker。

---

## 四、文档骨架

> 复制以下骨架到 `docs/HANDOFF-DOCS/<版本>/BATCH-<N>-HANDOFF.md`，逐节替换 `{{...}}` 并删除 `**编写要求：**` 块。

# 批次 {{N}} 交接文档

> 写给新 Session 的 Agent，启动 {{版本}} 批次 {{N}}（{{批次主题}}）。本文件只在 Session 开始时阅读一次；施工进度、问题、测试证据和状态变更只写入 `docs/{{版本}}-EXECUTION-TRACKER.md`，不要在本文件追加过程记录。

## 1. 项目概况

> **编写要求：** 全部来自「信息采集」命令的输出，逐条替换。环境一行要写清 Electron E2E 是否能正常运行（容器/沙箱是否受限），这决定接班 agent 能否自己跑 E2E。参考 worktree 若不存在就写「无」。

- **仓库**：`{{git rev-parse --show-toplevel}}`
- **分支**：`{{git branch --show-current}}`
- **起始提交**：`{{git rev-parse HEAD}}`（`{{git log -1 --oneline 的 message}}`）
- **版本基线**：`{{基线版本}}`（`{{基线 tag 或 hash}}`）是行为基线；当前进行 {{版本}} 开发。
- **环境**：{{平台 + E2E 是否可用；是否容器/沙箱受限}}
- **参考 worktree**：`{{reference worktree 路径}}`（detached @ 基线；最终审查前保持不动）或「无」。

## 2. 前置批次状态

> **编写要求：** 从 Tracker 第 5 节状态表 + 第 10 节执行记录摘抄。每个前置批次一句话「已完成 + 落地了什么」；再记录最近一次全量验证的真实数字与日期；已知 flaky 必须保留并注明完整证据在 Tracker，不得抹除。不要复制 Tracker 全文。

- {{前置批次 N}} 已完成：{{落地成果摘要，一句话}}。
- {{前置批次 N+1}} 已完成：{{落地成果摘要}}。
- {{最近一次全量验证}}：{{Vitest 数 / E2E 数 / 日期}}（例如 `441/441 Vitest`、`148/148 Electron E2E`，2026-09-04）。
- {{已知遗留 / flaky}}：{{一句话说明；证据位置在 Tracker，不得抹除}}。

## 3. 本批次范围与施工顺序

> **编写要求：** 从 Tracker 第 6 节本批次施工卡提取「目标 / 包含范围」，并按当前实际实施进度重排为有序子步骤；「不包含范围」直接抄施工卡的「不包含范围」，补上任何用户新强调的禁区。接班 agent 应照此顺序做，不要回到旧清单。

1. {{有序子步骤 1}}。
2. {{有序子步骤 2}}。
3. {{有序子步骤 3}}。

**不包含范围：** {{列出不要重做、不要重写、不要扩展的内容}}。

## 4. 现有归属与迁移目标

> **编写要求：** 读当前源码（通常 `src/renderer/app.js`），列出本批次要迁出的 legacy 职责，格式统一为「`legacy 函数名` → 目标 `模块名`」；再列出上一批次已迁移、本批次不得重做的职责及其语义 owner。这是全文档最依赖源码核对的一节，不要凭记忆写。

- {{迁移源 1}}：`{{legacy 函数名}}` → `{{目标模块}}`。
- {{迁移源 2}}：`{{legacy 函数名}}` → `{{目标模块}}`。

**已迁移、不要重复实现的职责：** {{上一批次的模块名 + 它保留的语义所有权}}。

## 5. 不可突破的边界

> **编写要求：** 通用边界固定保留下面四条（不展开，指向 AGENTS.md/契约文档）；再补 1–3 条「本批次专属边界」，从施工卡的「不包含范围 / 必须证明」提炼。不要整段粘贴 AGENTS.md。

- Vditor 固定为 `3.11.3`；所有私有 DOM、Range 和结构假设只能位于 `src/renderer/vditor-adapter.js`。
- 保持 `contextIsolation: true`、`nodeIntegration: false`；renderer 不导入 Node 内置模块，preload 只提供窄能力。
- 新增 listener、watcher、timer、rAF、observer 或订阅必须有明确 owner 和 close/switch/rebuild/shutdown cleanup。
- Linux 通过不代表 Windows/macOS 验证；平台限制继续记录在 `docs/03-CROSS-PLATFORM.md`。
- {{本批次专属边界 1}}。
- {{本批次专属边界 2}}。

## 6. 必须证明 / 验收标准

> **编写要求：** 从 Tracker 施工卡的「必须证明」和「完成标准」改写为可核查清单。每条用「行为保持 / 资源释放 / 私有 DOM 假设 / 测试证据」开头，禁止「基本完成」这类模糊措辞。

- {{行为保持项}}（例如：三种编辑模式的创建/切换/重建/滚动/undo 与基线一致）。
- {{资源释放项}}（例如：旧 runtime 在重建/关闭后完整释放，迟到 callback 不改当前状态）。
- {{私有 DOM 假设项}}（例如：每个假设都有 focused adapter test，并更新 `docs/06-VDITOR-UPGRADE.md`）。
- {{测试证据项}}（例如：本域源码字符串断言被行为测试替代）。

## 7. 首轮阅读顺序

> **编写要求：** 给出接班 agent 的阅读清单，标出 Tracker 的具体章节号，避免通读所有文档。用「只读取 XX 章节」限制范围。

1. `AGENTS.md`。
2. 本文件，然后不再重复读取。
3. `docs/{{版本}}-EXECUTION-TRACKER.md`：{{相关章节 + 本批次施工卡 + 前置批次最终记录}}。
4. `docs/{{版本}}-{{PLAN}}.md`：{{相关章节}}。
5. `docs/01-CODE-STRUCTURE.md`：只读取 {{相关域}} 章节。
6. `docs/05-FILE-SAFETY.md`、`docs/03-CROSS-PLATFORM.md`，涉及 Vditor 时读 `docs/06-VDITOR-UPGRADE.md`。
7. 实际源码、现有测试和 `{{基线}}` reference worktree；文档不是源码真相。

## 8. 当前测试风险与验证证据

> **编写要求：** 分两类写清楚，严禁混淆：①你本次实际运行的专项验证（写命令 + 真实通过数）；②Tracker 记录的用户全量验证（写数字 + 日期 + 来源）。已知 flaky / 精确重跑必须如实记录，并强调「精确重跑不等于干净全量通过」。

- {{专项验证，本次实际运行}}：{{测试文件与通过数}}（例如 `editor-controller.test.ts` 8/8、`typecheck:renderer` 通过）。
- {{全量验证，Tracker 记录}}：{{数字 + 日期}}（例如 2026-09-04 用户 `npm run check:all`：441/441 Vitest、148/148 E2E）。
- {{已知 flaky / 精确重跑}}：{{一句话 + 证据位置；不替代全量 E2E}}。

## 9. 工作约定

> **编写要求：** 这些是用户明确要求的约定，固定保留；若某批次用户有特殊约定，追加在最后。与 AGENTS.md 冲突时以用户本 Session 要求为准。

1. **专项测试按需运行**：可运行需沙箱外权限的专项测试（单测、单条 E2E、build）。命令：`npm run build`、`npm test`、`npm run check:vditor`、`npm run format:check`、`npm run lint`、`npm run typecheck`、`npm run typecheck:renderer`、`node scripts/run-electron-e2e.js tests/e2e/<file>.spec.ts -g "<name>"`。
2. **全量测试留给用户手动**：不要运行 `npm run check` 或 `npm run check:all`，除非用户明确改变该约定。
3. **代码修改后同步文档**：`CHANGELOG.md`（用户可见变化）、`docs/{{版本}}-EXECUTION-TRACKER.md`（§10 执行记录）、`docs/01-CODE-STRUCTURE.md`（新增文件/模块/职责边界）、`docs/06-VDITOR-UPGRADE.md`（Vditor 私有 DOM 假设变化），以及受影响的 `05-FILE-SAFETY.md` / `03-CROSS-PLATFORM.md` / `04-THEMES.md`。
4. **不做 git commit**：不要执行 `git add` / `git commit`；改动留在工作区，由用户全量测试通过后提交。
5. **开始前核对**：重新检查 `git status`、当前 HEAD 和 Tracker；若工作树含用户修改，保留并协作，不回退。

## 10. 批次结束要求

> **编写要求：** 这一节告诉接班 agent「做完后往 Tracker 写什么、以及不要擅自推进到下一批次」。

完成后在 Tracker 的批次 {{N}} 记录中说明：

- 哪些职责已迁出、哪些仅因后续批次依赖而保留。
- 各 controller / 模块的实际协作边界与状态所有权。
- 每种 runtime 资源的 owner 与 cleanup 位置。
- 每个私有 DOM 假设的 adapter 测试和升级文档位置。
- 失败/竞态/泄漏场景的测试证据，尤其是重建、关闭、切换标签和过期 callback。
- 每条专项验证的真实结果、用户全量验证结果及任何 E2E flaky 记录。

批次 {{N}} 完成后不要自动进入下一批次；等待用户启动。
