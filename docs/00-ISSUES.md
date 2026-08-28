> [!NOTE] Issues文档定位
>
> 本文档为临时性文档，随时记录当前版本问题；当对应问题关闭后，在此处收案数，并应用英文写入CHANGELOG.md对应开发版本的更新日志

## 0.2.0 已知限制

- 批次 4 的外部修改冲突、批次 5 的文件删除/重新出现/不可读状态、批次 5.1 的工作区读取/监听深度边界、批次 6 的目录级路径一致性、批次 7 的本地闭环以及批次 8 的导航/外部链接安全代码、专项验证、Linux 全量回归和手测均已完成；当前限制集中在跨应用重启后的外部状态恢复、IPC/本地资源安全、已有目标的长期 TOCTOU 和跨平台实体机验证。长期文件安全契约见 [`docs/05-FILE-SAFETY.md`](05-FILE-SAFETY.md)。
- Windows 与 macOS 尚未在实体机验证打开文档 watcher 的路径大小写语义和原子替换行为；跨平台测试清单统一见 [`docs/03-CROSS-PLATFORM.md`](03-CROSS-PLATFORM.md)。
- 批次 5.1 的工作区最大读取深度设置已实施并完成主要 Linux 手测；Home 等大型目录仍需持续观察性能。批次 6 的文件/目录重命名、目录删除和失效工作区复位已完成，相关跨平台实体机验证和 Save As 原生对话框手测仍待发布前复核。
- Windows `.lnk` 与 macOS Finder alias 暂按普通文件处理，不会作为目录链接展开；未来支持需要独立的平台解析与安全边界设计。

## 0.2.0 发版前需要完成的改善

- 继续完成 0.2.0 tracker 批次 9–17 中的 IPC 安全边界、受控本地资源、sandbox/CSP/sanitize、macOS 关闭状态、导出隔离、应用标识和 Linux 候选包发布门槛；批次 8 的 Linux 全量和手测通过不等同于 0.2.0 版本整体完成。具体 checkbox 和证据以 [`docs/13-0.2.0-EXECUTION-TRACKER.md`](13-0.2.0-EXECUTION-TRACKER.md) 及 [`docs/12-0.2.0-DEVELOPMENT-PLAN.md`](12-0.2.0-DEVELOPMENT-PLAN.md) 为准。
