# 资源健康专项交接文档

> 写给接手 0.2.5 资源健康专项的新 Session Agent。施工进度、最终验证和状态变更应更新 `docs/15-0.2.5-EXECUTION-TRACKER.md`，本文件仅描述当前未提交工作树的接手起点。

## 1. 项目概况

- **仓库**：`/home/shawnzhang/Projects/Vditor-Electron`
- **分支**：`dev-0.2.5`
- **当前 HEAD**：`7cca4671adeb49e23d15393ee4e427cbabbdcc47`（`7cca467 docs: Improve dev plan for resource health function.`）
- **版本基线**：`v0.2.0`（`bfaf25a`）；当前 `package.json` 版本仍为 `0.2.0`，0.2.5 尚未发布。
- **环境**：Linux。资源健康入口/工作区外禁用、回收站重验证和缺失引用删除/undo 的精确 Electron E2E 已取得终态通过；这些专项用例不替代完整 E2E 或跨平台验证。
- **工作树**：有本专项全部未提交改动；不可 `reset`、`checkout` 或覆盖。无参考 worktree。

## 2. 前置状态

- 批次 9 已完成：`app.js` legacy 已移除，`src/renderer/app/app-composition.js` 是组合边界；新功能必须由独立 controller/service 承担状态与行为。
- Toolbar UX 专项已完成且用户人工验证通过；不要改动其行为。
- Tracker 记录的批次 9 用户全量证据：523/523 Vitest；E2E 首轮 150/152，两项 known flaky 精确重跑通过，非一次性全绿（见 Tracker §10 批次 9）。
- 当前资源健康专项尚未写入 Tracker 完成记录，也未完成用户手测、完整 E2E 或跨平台验证。

## 3. 当前实现与职责归属

1. 主进程服务：`src/main/services/resource-health-service.ts`。
    - `ResourceHealthService.scan()` canonicalize 文档/工作区，扫描 Markdown/HTML 本地引用，枚举当前 `pasteImagesDir`，生成不含绝对路径的 revision DTO。
    - 上限在 `RESOURCE_HEALTH_LIMITS`：5,000 源文件、单文件 4 MiB、源文本总计 64 MiB、10,000 图片目录项、30 秒、预览 64 MiB。
    - `trashCandidates()` 每次回收站操作前重新扫描和验证；只能调用注入的 `shell.trashItem`，renderer 只能回传 revision 与 candidate ID。
    - `extractLocalReferences()` 会枚举单个 HTML 标签的全部 `src`、`srcset`、`href`、`xlink:href` 和 `poster`，不拆分含逗号的直接 URL；无法安全解析的 `srcset`、嵌套 Markdown 标签和嵌套目标会标记扫描不完整。
2. 跨进程边界：`src/main/index.ts` 注册 scan/reveal/preview/trash handlers；`ipc-contract.ts`、`ipc-validation.ts`、`preload.ts` 和 `types/bridges.d.ts` 已同步。预览 URL 由主进程构造受控 `local-file://` URL。
3. Renderer 页面：`src/renderer/resource-health/resource-health-controller.ts`，由 `src/renderer/pure-functions.ts` 导出，`app-composition.js` 仅创建 controller、注入 active tab/workspace/confirm 回调。
    - 页面有扫描顶层灰化、静态扫描状态文本、warning.svg 不可用覆盖层，以及放在扫描状态卡中替换 `check-circle.svg` 的持续 SVG analyzing image 动画；CSS 使用 2.9 秒周期并在扫描线左右端点各停留 0.2 秒。“未保存不参与扫描”提示继续使用 `lightbulb.svg`，候选/缺失 tabs、预览惰性加载、复制相对路径、reveal、回收站确认和缺失引用行列/原始片段列表均已接入。
    - dialog 使用 `aria-labelledby`、扫描中 inert、Tab 焦点环、Escape 和关闭后焦点恢复；扫描成功后焦点转至可见的重新扫描按钮。
    - `invalidate()` 已在切换标签、保存和切换工作区时由 composition 调用；结果过期后禁止回收站。
4. Vditor 语义操作：`src/renderer/vditor-adapter.js` 新增 `removeImageReference()`，并已同步 adapter facade、`adapter.d.ts`、`adapter-contract.ts` 和 adapter 单测。SV 使用精确原始片段替换；WYSIWYG/IR 选择匹配的图片 DOM，经 Vditor input/undo 路径删除。不得在 controller 中查询 Vditor 私有 DOM，也不得用 `getValue()/setValue()` 全文回写。
5. UI/样式/本地化：`src/renderer/styles/app.css`、`src/renderer/locales.js`（en_US/zh_Hans/zh_Hant）和 `src/main/menu.ts`。

## 4. 本轮实现与验证

### 已完成的安全收口

1. 候选图片现在同时要求受控扩展名和有限文件签名匹配；伪装为 `.png`、`.webp` 等扩展名的普通文件不会成为可清理候选。
2. 关闭资源健康页、保存、切换标签或工作区时，renderer 会请求主进程丢弃短生命周期 scan revision，撤销此前候选 ID 的操作能力。
3. 回收站前主进程仍会重新扫描并核验引用、工作区包含关系及文件修改时间/大小，随后才调用 `shell.trashItem`。
4. 缺失引用只通过 Vditor 语义编辑路径修改内存正文；渲染模式出现多个相同本地 URL 时 adapter 拒绝删除，避免猜测并删除不同的已确认引用。
5. macOS 原生 **Tools > Resource Health** 现在使用同一可信 eligibility 结果动态灰置；Windows/Linux 自绘菜单继续使用 renderer 的同一资格状态。
6. HTML 资源提取现在保护同一标签内的多个候选及 `poster`/SVG 链接属性，直接 URL 不会因逗号被拆分；转义 Markdown 链接不再误计为引用。
7. 缺失引用页显示每个位置的行列和原始片段，危险按钮带位置化无障碍名称；回收站 IPC 失败会恢复页面操作状态。
8. 候选行 hover 时按需加载缩略图；固定详情与列表显示修改时间，扫描元数据包括已保存文档、工作区、图片目录、保存时间和已扫描 Markdown/HTML 数量。
9. 回收站确认框列出每个选中目标；部分成功后页面保留逐项失败原因。资源健康页的确认框提升至其 modal 之上，避免危险确认被页面遮挡。
10. 主进程资格检查同时要求工作区是实际目录；误传普通文件路径会被拒绝，不会进入不完整扫描。
11. 扫描和错误顶层覆盖层内都有本地化关闭按钮；覆盖层不会再遮住唯一的鼠标退出路径，关闭会取消本次 generation 并丢弃扫描能力。
12. 入口资格只校验文档/工作区 canonical identity；实际扫描时 `pasteImagesDir` 的每个已存在路径段都经 `lstat` 检查，路径穿过符号链接即拒绝扫描，防止工作区内词法路径跟随到外部目录。

### 已完成的自动化验证

- `npm run format:check`、`npm run lint`、`npm run typecheck`、`npm run typecheck:renderer`、`npm run build`、`git diff --check`：通过。
- `npm test`：74 文件、561/561 通过。资源健康 service、controller 和 Vditor adapter 覆盖路径/引用提取、签名拒绝、回收站重验证、覆盖层、批量删除和渲染 URL 歧义拒绝。
- `npx playwright test tests/e2e/navigation-and-resources.spec.ts --grep "scans workspace resources"`：通过。
- 本轮聚焦 Vitest：`resource-health-service`、`resource-health-controller` 与 `vditor-adapter` 共 71/71 通过；覆盖编码 URL/query/fragment、引用定义、远程/`data:`/工作区外引用排除、显式选择候选的受控回收站操作、`pasteImagesDir` 符号链接拒绝、单份 Markdown 超限时的只读不完整结果、超预览上限图片仍为候选但不可预览、HTML 多属性/`srcset`、转义 Markdown、不可解码本地 URL 的保守阻断、自定义图片目录、SVG 开关、dialog 焦点、关闭后迟到扫描结果忽略、已完成扫描失效/丢弃 revision、缺失引用位置展示、扫描元数据和部分回收站失败明细。
- `node scripts/run-electron-e2e.js tests/e2e/navigation-and-resources.spec.ts --grep "scans workspace resources"`：通过（1/1）；真实 Electron 链路覆盖工作区内入口、受控 PNG 候选、取消确认无副作用、确认框目标明细、扫描后文件变更拒绝与工作区外入口灰置。
- `node scripts/run-electron-e2e.js tests/e2e/navigation-and-resources.spec.ts --grep "removes a selected missing reference"`：通过（1/1）；覆盖 Split View 精确删除、确认后结果过期、磁盘未写入与 Vditor undo 恢复。
- `node scripts/run-electron-e2e.js tests/e2e/navigation-and-resources.spec.ts --grep "scans the saved disk snapshot"`：通过（1/1）；覆盖未保存 Split View 编辑不改变磁盘快照扫描结果，以及成功保存后当前 scan revision 过期。
- 三条资源健康 E2E 合并筛选的首轮中，入口/重验证用例通过；随后缺失引用用例在打开菜单前超时，未执行到断言。该用例和保存快照用例各自精确重跑均为 1/1 通过；此结果不是一次性三条全绿，trace 保留在 `test-results/`。
- 扩展“保存后过期”断言时，首轮仅因测试预期了不存在的英文文本 `Scan results are stale` 而失败；实际页面已经显示 `result has expired`/`Scan again`。修正为当前本地化文本后精确重跑 1/1 通过；这不是产品回归。
- 完整 `npm run test:e2e`：154/157；资源健康新增用例通过。3 项失败属于既有 `app-shell` 标签滚动、主题表面色和 `editor-modes` 大纲导航用例，未归因为本专项；失败 trace 保留在 `test-results/`。

### 仍需人工和跨平台证据

- 按 `docs/18-0.2.5-RESOURCE-HEALTH.md` 手测共享资源目录、自定义 `pasteImagesDir`、未保存编辑不参与扫描、SVG 开关与系统回收站恢复。
- Windows/macOS 原生验证统一见 [`docs/03-CROSS-PLATFORM.md` §14](../../03-CROSS-PLATFORM.md#14-025-resource-health-deferred-windowsmacos-native-verification)：系统回收站/Finder 恢复、共享与自定义目录、未保存快照、SVG 边界、扫描后变更拒绝，以及 macOS 原生 Tools 菜单动态灰置。Linux 自动化不能替代这些原生证据。

## 5. 已知缺口与优先顺序

1. **复杂引用的保守边界。** 当前提取器保护 HTML 多资源属性，将嵌套 Markdown、无法安全简化的 `srcset` 和不可解码本地 URL 标记为 `unparseable` 并阻断回收站；后续新语法仍须先增加 fixture，不能把无法安全理解的内容当成未引用。
2. **复杂引用的删除边界。** 渲染模式中 URL 不能唯一对应一个图片 DOM 时 adapter 会拒绝删除；这不是自动修复或全文回写路径。
3. **原生证据。** 自动化已覆盖入口资格、覆盖层焦点交接、候选详情、回收站重验证和 Split View 缺失引用删除/undo；Windows/macOS 待验证项与记录格式统一见 [`docs/03-CROSS-PLATFORM.md` §14](../../03-CROSS-PLATFORM.md#14-025-resource-health-deferred-windowsmacos-native-verification)。

## 6. 开发子步骤清单（持续更新）

> 勾选仅表示代码与对应的已知自动化证据已具备；专项整体只有在完整 E2E、用户手测和文档收尾完成后才能标记完成。

### 扫描、路径与安全

- [x] 实现主进程资源健康服务、版本化扫描 DTO、扫描 revision 与受控候选 ID。
- [x] 实现工作区 Markdown/HTML 引用扫描、候选/缺失分类、资源限制与扫描不完整时的回收站阻断。
- [x] 实现 canonical 路径、工作区包含关系、符号链接和隐藏项的基础保护。
- [x] 实现 Markdown/HTML 基础引用、URL 编码、query/fragment、代码围栏和行内代码排除。
- [x] 对嵌套 Markdown 目标等无法安全理解的语法标记 `unparseable` 并阻断回收站。
- [x] 对包含无法安全简化目标的 `srcset` 标记 `unparseable` 并补充服务测试。
- [x] 审计并补齐复杂 Markdown、HTML `srcset` 与不可解码本地 URL 的保守解析及测试覆盖。
- [x] 候选格式以受控扩展名和有限签名策略确认；本地资源协议继续只授权受控 MIME 响应。

### 入口与跨进程边界

- [x] 接入 scan、preview、reveal、trash 的窄 IPC/preload 能力与参数校验。
- [x] 新增主进程拥有的资源健康资格检查，并在标签切换、工作区切换、保存和会话恢复后刷新 renderer 菜单状态。
- [x] 使 macOS 原生菜单也根据可信资格动态灰置资源健康入口。
- [x] 保持 renderer 不获得绝对候选路径、目录遍历或通用删除能力。

### 页面与交互

- [x] 实现资源健康独立页面、扫描静态状态覆盖层、不可用 warning 覆盖层、三语文案及持续 analyzing image 动画。
- [x] 实现覆盖层焦点接管、底层 inert、Tab 焦点环、Escape 关闭和关闭后的焦点恢复。
- [x] 将资源健康页面收束为 `modal-card` 标准页面，支持标题栏拖拽并禁止页面文字选择。
- [x] 实现候选选择、惰性预览、不可预览占位、固定详情面板、复制路径、文件管理器定位与选择数量/大小摘要。
- [x] 实现回收站结果提示，以及成功后重新扫描。
- [x] 补齐候选行 hover 缩略 tooltip、修改时间/扫描范围等完整元数据展示和细粒度部分失败结果。
- [x] 实现缺失引用逐项删除、批量选择删除、当前编辑器内容重验证、跳过/结果提示与扫描结果过期。
- [x] 补齐批量确认中目标/引用数的完整可视化，以及复杂 HTML 精确删除支持或明确拒绝边界。

### 回收站、测试与收尾

- [x] 实现回收站前重新扫描、引用重验证、文件变化检测和逐项结果代码。
- [x] 添加资源健康 service、controller 和 adapter 的聚焦单元测试。
- [x] 为批量缺失引用选择、单次确认、逐项语义删除，以及候选不可预览占位/已选摘要补充 controller 单元测试。
- [x] 完成入口资格、预览/详情与部分回收站失败的单元/DOM 测试覆盖；复杂解析继续保守处理，见上文未解析语法边界。
- [x] 修复资源健康 Electron E2E：工作区外文档断言入口禁用，已取得一次精确重跑终态证据。
- [x] 扩展并取得资源健康 Electron E2E：回收站重验证、缺失引用删除/undo、覆盖层焦点和部分失败均有专项证据；不替代完整 E2E。
- [ ] 完成专项用户手测，包括共享 `assets/`、自定义图片目录、未保存编辑、回收站和 SVG 开关。
- [x] 更新 `docs/01-CODE-STRUCTURE.md`、`docs/03-CROSS-PLATFORM.md`、`CHANGELOG.md` 和本交接文档；Tracker 保持批次执行记录，不重复收录专项交接细节。

## 7. 不可突破的边界

- Vditor 固定 `3.11.3`；私有 DOM/Range 仅限 `src/renderer/vditor-adapter.js`。
- 保持 `contextIsolation: true` 和 `nodeIntegration: false`；renderer 不导入 Node，preload 只暴露命名窄能力。
- 主进程拥有路径、扫描、预览授权、reveal 与回收站；绝不向 renderer 返回可写的绝对路径或通用文件系统能力。
- `app-composition.js` 只组合依赖和窄协调回调；不要向其中堆积扫描状态、DOM、bridge 调用或路径规则。
- 不引入 React、shadcn、Tailwind、motion 或任何新依赖；替换 `check-circle.svg` 的持续 analyzing image 动画必须保持原生 DOM/CSS，扫描覆盖层文字保持静态。
- 不自动扫描、删除、保存或修改 Markdown；回收站只处理显式选择、完成扫描 revision、且即时重新验证仍安全的候选。

## 8. 已实际运行的验证

- 历史完整结果见本文件 §4：format、lint、双端 typecheck、build、`git diff --check`、561 个 Vitest 测试和资源健康精确 Electron E2E 均通过；本轮针对新改动的聚焦 Vitest 为 71/71。
- 完整 Electron 回归为 154/157；3 个非资源健康失败及其 trace 说明见 §4，不能表述为全量 E2E 通过。

用户明确约定：不要运行 `npm run check` 或 `npm run check:all`；可按需运行 focused unit、single E2E、typecheck、lint、build。不要 `git add` 或 `git commit`。

## 9. 首轮阅读顺序

1. `AGENTS.md`。
2. 本文件，只在接手时读一次。
3. `docs/18-0.2.5-RESOURCE-HEALTH.md`：重点 §4–§10 和 §9 验收标准。
4. `docs/15-0.2.5-EXECUTION-TRACKER.md`：只读批次 9 记录（约 §10 后段）与资源健康专项索引项。
5. `docs/01-CODE-STRUCTURE.md`：只读 main IPC、renderer composition、Vditor adapter、local resource 对应章节；随后以源码为准。
6. 上列新增 service/controller 和三个专项测试；再处理 E2E。

## 10. 结束要求

完成专项前逐项核对 `docs/18-0.2.5-RESOURCE-HEALTH.md` §9，尤其是入口资格、扫描不完整阻断、重验证、覆盖层/可访问性、缺失引用 undo/未保存行为、三语和 E2E。完成后如实更新 Tracker，不自动进入下一批次；等待用户进行全量测试和人工验证。
