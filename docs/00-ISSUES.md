> [!NOTE] ✏️ Issues文档定位
>
> 本文档为临时性文档，随时记录当前版本问题；当对应问题关闭后，在此处收案数，并应用英文写入CHANGELOG.md对应开发版本的更新日志

## SV 撤销回到保存内容后仍显示未保存标记

**状态：** 递延至 Vditor 4.0 升级验证。

在 Vditor 3.11.3 的 SV 模式中，编辑后撤销到视觉上与最后保存内容一致的状态时，文档标签仍可能显示未保存标记。Desktop 的脏状态由 Vditor `input(value)` 与 `tab.savedContent` 的严格字符串比较决定；Vditor 的 undo 工具栏状态只反映私有 undo/redo stack 长度，不表示应用层保存点，不能用于清除脏标记。

尚未捕获该场景下两份 Markdown 的首个实际字符差异，不能在 3.11.3 中直接放宽比较或自动清除标记。Vditor 4.0 将 SV 从 `contenteditable <pre>` 重构为 `<textarea>`，undo 直接恢复 `value` 和 selection，可能消除 3.11.3 私有 DOM 序列化导致的差异；但其 `getMarkdown()` 仍会规范化末尾换行，因此不能预先承诺升级必然解决。

0.3.0 的 Vditor 4.0 迁移必须增加保存后编辑、撤销到保存内容的 dirty-state 矩阵，并记录 `input(value)`、`savedContent`、首个差异 offset 和写盘结果。仅在确认输出与保存基线满足既定文档保真约束后关闭本问题。
