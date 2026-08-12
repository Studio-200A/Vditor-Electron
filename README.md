# Vditor Desktop

基于 Electron 和 Vditor 的离线 Markdown 桌面编辑器，面向 Linux 桌面。

## 已实现

- Vditor WYSIWYG / IR / SV 三种模式及离线资源加载
- 多标签编辑、打开、保存、另存为、自动保存和未保存提示
- 工作区目录树、创建、重命名、回收站删除和拖拽移动
- Markdown 大纲、深浅主题、设置持久化和系统主题跟随
- 文件变更监控、标签/工作区独立恢复、最近文件/工作区记录
- 分栏源码行号、标题折叠、空格标记、自动缩进和可拖动分割线
- 本地图片保存与压缩、HTML / PDF 导出、Markdown 文件拖入打开
- UTF-8、UTF-8 BOM 和 GB18030 文本读取
- Linux AppImage / deb / rpm 构建配置

## 开发与构建

```bash
npm install
npm run dev
```

构建并生成可直接运行的 Linux 目录：

```bash
npm run pack
./release/linux-unpacked/vditor-electron
```

生成发行包：

```bash
npm run dist:linux
```

Vditor 的动态依赖会在构建时复制到 `static/dist`，renderer 会复制到 `dist/renderer`，因此打包产物不依赖网络 CDN。

应用设置保存在 `~/.vditor-desktop/settings.json`。自更新尚未接入，因为它需要项目的发布仓库、更新源和签名策略。
