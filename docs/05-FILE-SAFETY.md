# 文件安全与并发写入契约

> 本文档是 Vditor-Electron 文件生命周期安全模型的长期维护入口，不绑定某个版本或开发批次。

## 1. 用途与文档职责

本文档定义本地 Markdown 文件的身份、保存、外部变化、恢复和 watcher 协作必须保持的安全不变量，尤其记录当前 Node.js/文件系统能力无法消除的并发边界。

文档职责按以下方式分离：

- 本文档记录长期有效的行为契约、风险边界和关闭条件。
- [`docs/13-0.2.0-EXECUTION-TRACKER.md`](13-0.2.0-EXECUTION-TRACKER.md) 记录 0.2.0 批次 7 的历史发现、实施过程和 Linux 验证证据。
- [`docs/03-CROSS-PLATFORM.md`](03-CROSS-PLATFORM.md) 记录 Windows/macOS/Linux 的平台差异、实体机验证方法和证据；它不替代本文档的通用安全契约。
- [`docs/14-0.2.5-RENDERER-REFACTOR-PLAN.md`](14-0.2.5-RENDERER-REFACTOR-PLAN.md) 记录重构时必须原样保留的契约和迁移要求。

后续只要修改保存、Save As、文件/目录重命名、恢复、外部冲突或 watcher，就必须同时检查本文档；若不变量、缓解措施或已知边界发生变化，应在同一变更中更新本文档。

## 2. 必须保持的不变量

- 外部程序已经改变目标文件时，普通保存不得静默覆盖该变化；不确定时进入明确的冲突或失败结果。
- 同一个物理文件在标签、保存队列、冲突状态、不可用状态和 watcher 生命周期中必须使用同一个 canonical identity。展示路径可以变化，不能代替 identity 做所有权判断。
- 文件删除或暂时不可读时，不得因为磁盘状态变化而丢弃仍在内存中的正文；需要保留正文并暂停可能造成覆盖的自动保存。
- 关闭标签、Save As、工作区切换、重命名和重建 editor 后到达的旧异步结果不得写入新的路径或新的标签状态。
- watcher 的绑定必须经历“创建 → `ready` → 读取一次当前磁盘事实 → 接收实时事件”；`ignoreInitial` 不能替代 ready 后的 reconciliation。
- 用于展示的解码正文和用于安全写入比较的 `expectedBytes` 必须来自同一次原始磁盘读取，不能让两次读取之间的变化被误认为同一版本。

## 3. 文件身份

文件路径有两个不同用途：

- `displayPath`/`filePath` 用于界面展示、文件 API 参数、相对资源计算和用户选择结果。
- `fileIdentity` 用于判断两个标签是否拥有同一资源，以及去重、保存串行化、冲突、不可用状态、watcher 释放和重绑。

当前 identity 规则由 `src/main/services/file-identity.ts` 统一提供：对已存在路径使用 `realpath` 解析符号链接；目标暂不存在时，解析已存在的祖先并把缺失部分接回；只在 Windows 规则下统一大小写，不把 Linux 或所有 macOS 卷都假定为大小写不敏感。

因此，路径发生重命名、Save As、删除后重新出现或通过符号链接访问时，必须重新核对 identity，并保留旧 identity 直到新绑定和状态提交已经明确完成。

## 4. 保存与替换流程

一次普通保存或自动保存应当携带以下快照：

1. renderer 当前正文及其 `contentRevision`；
2. 目标的 `fileIdentity`；
3. 当前保存基线正文，或目标应当不存在的声明；
4. 保存过程中用于判断结果是否仍属于当前标签的 revision/identity。

主进程的 `FileManagerService.writeDocument()` 负责把基线正文读取为原始字节，使用这同一份字节完成解码后的基线确认，并把它传给 `SafeFileWriter`。写入器在目标同目录创建唯一临时文件，以排他方式写入、同步、关闭，尽可能保留原文件权限，再执行最终替换；失败时清理临时文件但不主动删除原目标。

当调用方声明目标应当不存在时，当前实现使用临时文件的原子 hard-link 创建最终名称，目标已被占用会返回可处理的外部变化结果。该 no-replace 原语在 Windows/macOS 上的真实权限、占用和失败语义仍由 [`docs/03-CROSS-PLATFORM.md` §9](03-CROSS-PLATFORM.md#9-020-batch-7-deferred-platform-validation) 验证。

## 5. 外部变化与恢复

document watcher 读取稳定磁盘正文后，renderer 以保存基线、本地正文和统一 identity 判断是自身写入、可直接刷新，还是需要进入显式冲突。冲突解决前，普通保存和自动保存不能把外部正文静默替换掉。

文档变为 `deleted`、`unreadable` 或 recovery 状态时，正文和状态必须保持可解释：用户可以重新加载、另存或放弃；不能因为一次 watcher 事件、读取失败或应用重启而把唯一的本地正文丢掉。recovery 数据仍属于应用数据边界，不应通过文件协议、日志或候选列表暴露正文。

## 6. watcher 生命周期与过期结果

每个 document binding 需要同时受 binding generation 和读取 revision 保护：

- 关闭、重绑或替换 binding 时使旧 generation 失效；
- 同一 binding 启动新的稳定读取时递增 read revision，旧读取完成后不得发送事件；
- watcher `ready` 前到达的事件、打开/重绑空窗中的变化，以及显式要求的重绑，都必须合并到 ready 后的一次 reconciliation；
- 所有 timer、watcher 和重试路径在关闭标签、切换工作区、重命名和应用退出时清理。

这组规则保护的是“最新磁盘事实”和状态所有权，不是简单延长一个时间窗口。具体实现位于 `src/main/services/file-watch-service.ts`，renderer 只消费语义化文件事件。

## 7. 已知原子性边界：已有目标的 TOCTOU

### 7.1 当前仍不能宣称的保证

当保存已有文件时，当前流程大致为：

```text
读取并确认 expectedBytes
        ↓
写入并同步同目录临时文件
        ↓
再次读取并确认 expectedBytes
        ↓
rename(临时文件, 目标文件)
```

最后一次基线复核和 `rename()` 之间仍存在一个很短的竞争窗口。外部程序可以在复核成功后、替换发生前修改目标；Node.js 当前提供的常规跨平台文件 API 没有让本实现对已有目标执行“仅当内容仍为 X 才替换”的通用原子 CAS 原语。因此，当前代码不能声称在数学意义上消除了所有 TOCTOU 覆盖风险。

### 7.2 当前缓解措施

- renderer 在保存前携带期望正文或“期望不存在”的基线；
- `FileManagerService` 将一次原始读取得到的字节传入安全写入器；
- 安全写入器在临近最终替换处再次复核已有目标；
- 新目标使用 no-replace hard-link，降低目标竞争导致的覆盖风险；
- 基线不一致、目标读取不确定或替换失败时返回明确结果，保留用户内容并进入冲突/失败处理；
- watcher 的稳定读取和自身写入标记用于识别后续事件，但不能被当作原子提交证明。

### 7.3 关闭条件与后续归属

只有在选定的目标平台上具备可验证的条件替换/锁定方案，且该方案覆盖权限、占用、外部修改、失败清理和 watcher 反馈后，才能把本边界改记为已关闭。届时必须同时更新实现、聚焦回归测试、平台验证矩阵和本文档；仅增加重试、延迟或 watcher 抑制时间不构成关闭证据。

在此之前，问题 7 的本地修复状态是“风险窗口已缩小并可显式处理”，不是“绝对不会覆盖”。Windows/macOS 的原生行为验证和平台方案决策继续记录在 [`docs/03-CROSS-PLATFORM.md` §9](03-CROSS-PLATFORM.md#9-020-batch-7-deferred-platform-validation)，不再依赖 0.2.0 tracker 的日常关注度。

## 8. 维护入口与验证

修改相关行为时，至少回查以下实现和测试：

- `src/main/services/file-manager.ts` 与 `src/main/services/safe-file-writer.ts`：基线、临时文件、替换和错误结果；
- `src/main/services/file-identity.ts`：已存在、缺失祖先、大小写和符号链接 identity；
- `src/main/services/file-watch-service.ts`：ready/reconciliation、generation、read revision 和 cleanup；
- `src/renderer/app.js`：content revision、保存队列、冲突/恢复状态和路径重绑定；
- `tests/unit/` 中对应的文件管理、identity、watcher、recovery 测试，以及 `tests/e2e/document-lifecycle.spec.ts` 中的文件生命周期回归。

截至 2026-08-27，用户在 Linux 手动运行的 `npm run check:all` 已通过；该次运行的精确结果记录在 [`docs/13-0.2.0-EXECUTION-TRACKER.md` 的批次 7](13-0.2.0-EXECUTION-TRACKER.md#批次-7阶段-b-独立复核)。该证据证明当前本地回归闭环，不关闭第 7 节的已有目标 TOCTOU 边界，也不替代 [`docs/03-CROSS-PLATFORM.md` §9](03-CROSS-PLATFORM.md#9-020-batch-7-deferred-platform-validation) 的 Windows/macOS 实机证据。

版本 tracker 可以关闭一个批次的本地 TODO，但不得删除本文档的长期边界；若未来验证证明边界仍存在，只更新证据和状态，不用历史版本的“已完成”替代当前安全结论。
