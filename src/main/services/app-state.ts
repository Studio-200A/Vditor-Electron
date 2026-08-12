export interface AppSettings {
  restoreTabs: boolean;
  restoreWorkspace: boolean;
  systemTheme: boolean;
  theme: 'classic' | 'dark';
  contentTheme: string;
  codeTheme: string;
  iconSet: 'ant' | 'material';
  locale: string;
  uiFontFamily: string;
  editorFontFamily: string;
  editorFontSize: number;
  previewFontFamily: string;
  previewFontSize: number;
  previewCodeFontFamily: string;
  previewCodeFontSize: number;
  uiZoom: number;
  editorZoom: number;
  previewZoom: number;
  editMode: 'wysiwyg' | 'ir' | 'sv';
  previewMode: 'both' | 'editor';
  placeholder: string;
  typewriterMode: boolean;
  tabString: string;
  tabInsertSpaces: boolean;
  tabSize: 2 | 4 | 6 | 8;
  showWhitespace: boolean;
  autoIndent: boolean;
  rtl: boolean;
  autoSave: boolean;
  autoSaveDelay: number;
  wordWrap: boolean;
  editorTextWidth: number;
  previewTextWidth: number;
  splitRatio: number;
  toolbarConfig: { hide: boolean; pin: boolean };
  toolbarItems: string[];
  previewDelay: number;
  previewMaxWidth: number;
  mathEngine: 'KaTeX' | 'MathJax';
  enableHighlight: boolean;
  lineNumbers: boolean;
  enableAutoSpace: boolean;
  enableCallout: boolean;
  enableFootnotes: boolean;
  enableImageCaption: boolean;
  enableMark: boolean;
  enableSub: boolean;
  enableSup: boolean;
  scrollSync: boolean;
  pasteImagesDir: string;
  imageMaxWidth: number;
  imageQuality: number;
  paragraphBeginningSpace: boolean;
  fixTermTypo: boolean;
  gfmAutoLink: boolean;
  toc: boolean;
  listStyle: boolean;
  headingAnchor: boolean;
  sanitize: boolean;
  sidebarWidth: number;
  sidebarVisible: boolean;
  toolbarVisible: boolean;
  windowBounds: { x: number | undefined; y: number | undefined; width: number; height: number };
  windowMaximized: boolean;
  defaultOpenPath: string;
  recentPaths: string[];
  recentFiles: RecentFile[];
  fileExplorer: { visibleExtensions: string[] };
  session: AppSession;
}

export interface AppSession {
  workspacePath: string;
  activeFilePath: string | null;
  openFiles: string[];
}

export interface RecentFile {
  path: string;
  title: string;
  openedAt: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  restoreTabs: true,
  restoreWorkspace: true,
  systemTheme: true,
  theme: 'classic',
  contentTheme: 'light',
  codeTheme: 'github',
  iconSet: 'ant',
  locale: 'system',
  uiFontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  editorFontFamily: '"JetBrains Mono", "Fira Code", monospace',
  editorFontSize: 16,
  previewFontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  previewFontSize: 16,
  previewCodeFontFamily: '"JetBrains Mono", "Fira Code", monospace',
  previewCodeFontSize: 14,
  uiZoom: 100,
  editorZoom: 100,
  previewZoom: 100,
  editMode: 'ir',
  previewMode: 'both',
  placeholder: '',
  typewriterMode: false,
  tabString: '\t',
  tabInsertSpaces: false,
  tabSize: 4,
  showWhitespace: false,
  autoIndent: true,
  rtl: false,
  autoSave: true,
  autoSaveDelay: 2000,
  wordWrap: true,
  editorTextWidth: 100,
  previewTextWidth: 100,
  splitRatio: 50,
  toolbarConfig: { hide: false, pin: false },
  toolbarItems: [],
  previewDelay: 1000,
  previewMaxWidth: 800,
  mathEngine: 'KaTeX',
  enableHighlight: true,
  lineNumbers: false,
  enableAutoSpace: false,
  enableCallout: true,
  enableFootnotes: true,
  enableImageCaption: false,
  enableMark: false,
  enableSub: false,
  enableSup: false,
  scrollSync: true,
  pasteImagesDir: './assets',
  imageMaxWidth: 1024,
  imageQuality: 0.85,
  paragraphBeginningSpace: false,
  fixTermTypo: false,
  gfmAutoLink: true,
  toc: false,
  listStyle: false,
  headingAnchor: false,
  sanitize: true,
  sidebarWidth: 260,
  sidebarVisible: false,
  toolbarVisible: true,
  windowBounds: { x: undefined, y: undefined, width: 1200, height: 800 },
  windowMaximized: false,
  defaultOpenPath: '',
  recentPaths: [],
  recentFiles: [],
  fileExplorer: { visibleExtensions: ['md'] },
  session: { workspacePath: '', activeFilePath: null, openFiles: [] },
};
