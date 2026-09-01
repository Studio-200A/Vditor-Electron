import { BrowserWindow, Menu, MenuItemConstructorOptions } from 'electron';
import { IPC_CHANNELS } from './ipc-contract';

function emit(win: Electron.BaseWindow | undefined, action: string, value?: string): void {
  if (win instanceof BrowserWindow) win.webContents.send(IPC_CHANNELS.menuAction, action, value);
}

type EditMode = 'wysiwyg' | 'ir' | 'sv';

export function createAppMenu(locale: string = 'en_US', editMode: EditMode = 'ir'): Menu {
  const tr = (english: string, simplifiedChinese: string, traditionalChinese: string): string => {
    if (locale === 'zh_Hans') return simplifiedChinese;
    if (locale === 'zh_Hant') return traditionalChinese;
    return english;
  };
  const template: MenuItemConstructorOptions[] = [
    {
      label: tr('File', '文件', '檔案'),
      submenu: [
        {
          label: tr('New File', '新建文件', '新增檔案'),
          accelerator: 'CmdOrCtrl+N',
          click: (_i, w) => emit(w, 'new'),
        },
        {
          label: tr('Open File…', '打开文件…', '開啟檔案…'),
          accelerator: 'CmdOrCtrl+Alt+O',
          click: (_i, w) => emit(w, 'open'),
        },
        {
          label: tr('Open Folder…', '打开文件夹…', '開啟資料夾…'),
          accelerator: 'CmdOrCtrl+Alt+K',
          click: (_i, w) => emit(w, 'open-folder'),
        },
        { type: 'separator' },
        {
          label: tr('Save', '保存', '儲存'),
          accelerator: 'CmdOrCtrl+S',
          click: (_i, w) => emit(w, 'save'),
        },
        {
          label: tr('Save As…', '另存为…', '另存新檔…'),
          accelerator: 'CmdOrCtrl+Shift+S',
          click: (_i, w) => emit(w, 'save-as'),
        },
        {
          label: tr('Export HTML…', '导出 HTML…', '匯出 HTML…'),
          click: (_i, w) => emit(w, 'export-html'),
        },
        {
          label: tr('Export PDF…', '导出 PDF…', '匯出 PDF…'),
          click: (_i, w) => emit(w, 'export-pdf'),
        },
        { type: 'separator' },
        {
          label: tr('Close Tab', '关闭标签页', '關閉分頁'),
          accelerator: 'CmdOrCtrl+W',
          click: (_i, w) => emit(w, 'close-tab'),
        },
        {
          label: tr('Close Window', '关闭窗口', '關閉視窗'),
          accelerator: 'CmdOrCtrl+Shift+W',
          role: 'close',
        },
      ],
    },
    {
      label: tr('View', '视图', '檢視'),
      submenu: [
        {
          label: tr('Editing Mode', '编辑模式', '編輯模式'),
          submenu: [
            {
              label: tr('WYSIWYG Mode', '所见即所得模式', '所見即所得模式'),
              type: 'radio',
              checked: editMode === 'wysiwyg',
              click: (_i, w) => emit(w, 'mode', 'wysiwyg'),
            },
            {
              label: tr('Instant Rendering Mode', '即时渲染模式', '即時渲染模式'),
              type: 'radio',
              checked: editMode === 'ir',
              click: (_i, w) => emit(w, 'mode', 'ir'),
            },
            {
              label: tr('Split Preview Mode', '分栏预览模式', '分欄預覽模式'),
              type: 'radio',
              checked: editMode === 'sv',
              click: (_i, w) => emit(w, 'mode', 'sv'),
            },
          ],
        },
        { type: 'separator' },
        {
          label: tr('Toggle Sidebar', '切换侧边栏', '切換側邊欄'),
          accelerator: 'CmdOrCtrl+Alt+B',
          click: (_i, w) => emit(w, 'toggle-sidebar'),
        },
        {
          label: tr('Settings', '设置', '設定'),
          accelerator: 'CmdOrCtrl+,',
          click: (_i, w) => emit(w, 'settings'),
        },
        { type: 'separator' },
        { role: 'togglefullscreen', accelerator: 'F11' },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}
