import { BrowserWindow, Menu, MenuItemConstructorOptions, shell } from 'electron';

function emit(win: Electron.BaseWindow | undefined, action: string, value?: string): void {
  if (win instanceof BrowserWindow) win.webContents.send('menu:action', action, value);
}

export function createAppMenu(locale: string = 'en_US'): Menu {
  const zh = locale === 'zh_CN';
  const tr = (english: string, chinese: string): string => (zh ? chinese : english);
  const template: MenuItemConstructorOptions[] = [
    {
      label: tr('File', '文件'),
      submenu: [
        {
          label: tr('New File', '新建文件'),
          accelerator: 'CmdOrCtrl+N',
          click: (_i, w) => emit(w, 'new'),
        },
        {
          label: tr('Open File…', '打开文件…'),
          accelerator: 'CmdOrCtrl+O',
          click: (_i, w) => emit(w, 'open'),
        },
        {
          label: tr('Open Folder…', '打开文件夹…'),
          accelerator: 'CmdOrCtrl+K',
          click: (_i, w) => emit(w, 'open-folder'),
        },
        { type: 'separator' },
        {
          label: tr('Save', '保存'),
          accelerator: 'CmdOrCtrl+S',
          click: (_i, w) => emit(w, 'save'),
        },
        {
          label: tr('Save As…', '另存为…'),
          accelerator: 'CmdOrCtrl+Shift+S',
          click: (_i, w) => emit(w, 'save-as'),
        },
        { label: tr('Export HTML…', '导出 HTML…'), click: (_i, w) => emit(w, 'export-html') },
        { label: tr('Export PDF…', '导出 PDF…'), click: (_i, w) => emit(w, 'export-pdf') },
        { type: 'separator' },
        {
          label: tr('Close Tab', '关闭标签页'),
          accelerator: 'CmdOrCtrl+W',
          click: (_i, w) => emit(w, 'close-tab'),
        },
        { label: tr('Close Window', '关闭窗口'), accelerator: 'CmdOrCtrl+Shift+W', role: 'close' },
      ],
    },
    {
      label: tr('Edit', '编辑'),
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: tr('View', '视图'),
      submenu: [
        {
          label: tr('Toggle Sidebar', '切换侧边栏'),
          accelerator: 'CmdOrCtrl+B',
          click: (_i, w) => emit(w, 'toggle-sidebar'),
        },
        {
          label: tr('Settings', '设置'),
          accelerator: 'CmdOrCtrl+,',
          click: (_i, w) => emit(w, 'settings'),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'toggleDevTools', accelerator: 'F12' },
      ],
    },
    {
      label: tr('Mode', '模式'),
      submenu: [
        { label: tr('WYSIWYG', '所见即所得'), click: (_i, w) => emit(w, 'mode', 'wysiwyg') },
        { label: tr('Instant Rendering', '即时渲染'), click: (_i, w) => emit(w, 'mode', 'ir') },
        { label: tr('Split View', '分屏预览'), click: (_i, w) => emit(w, 'mode', 'sv') },
      ],
    },
    {
      label: tr('Theme', '主题'),
      submenu: [
        { label: tr('Classic', '浅色'), click: (_i, w) => emit(w, 'theme', 'classic') },
        { label: tr('Dark', '深色'), click: (_i, w) => emit(w, 'theme', 'dark') },
      ],
    },
    {
      label: tr('Help', '帮助'),
      submenu: [
        {
          label: tr('About Vditor Desktop', '关于 Vditor Desktop'),
          click: (_i, w) => emit(w, 'about'),
        },
        {
          label: 'Vditor on GitHub',
          click: () => void shell.openExternal('https://github.com/Vanessa219/vditor'),
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}
