import type { EditMode } from '../state/types.js';
import type { VditorOptions } from '../types/vditor.js';

export const VDITOR_INITIALIZATION_SETTINGS = new Set([
  'iconSet',
  'locale',
  'placeholder',
  'typewriterMode',
  'tabInsertSpaces',
  'tabSize',
  'rtl',
  'toolbarItems',
  'previewDelay',
  'previewMaxWidth',
  'multiPlatformPreview',
  'mathEngine',
  'enableHighlight',
  'lineNumbers',
  'enableAutoSpace',
  'enableCallout',
  'enableFootnotes',
  'enableImageCaption',
  'enableMark',
  'enableSub',
  'enableSup',
  'paragraphBeginningSpace',
  'fixTermTypo',
  'gfmAutoLink',
  'toc',
  'listStyle',
  'sanitize',
]);

export interface EditorOptionsSettings {
  readonly theme: string;
  readonly iconSet: 'ant' | 'material';
  readonly placeholder: string;
  readonly typewriterMode: boolean;
  readonly tabInsertSpaces: boolean;
  readonly tabSize: number | string;
  readonly rtl: boolean;
  readonly toolbarItems: string[];
  readonly previewMode: 'both' | 'editor';
  readonly previewDelay: number;
  readonly previewMaxWidth: number;
  readonly multiPlatformPreview: boolean;
  readonly enableHighlight: boolean;
  readonly lineNumbers: boolean;
  readonly codeTheme: string;
  readonly mathEngine: 'KaTeX' | 'MathJax';
  readonly enableAutoSpace: boolean;
  readonly enableCallout: boolean;
  readonly enableFootnotes: boolean;
  readonly enableImageCaption: boolean;
  readonly enableMark: boolean;
  readonly enableSub: boolean;
  readonly enableSup: boolean;
  readonly toc: boolean;
  readonly paragraphBeginningSpace: boolean;
  readonly fixTermTypo: boolean;
  readonly gfmAutoLink: boolean;
  readonly listStyle: boolean;
  readonly sanitize: boolean;
  readonly contentTheme: string;
}

export interface EditorOptionsTab {
  readonly content: string;
  readonly mode: EditMode;
  readonly baseDir: string;
}

export interface EditorOptionsDependencies<TTab extends EditorOptionsTab> {
  readonly settings: EditorOptionsSettings;
  readonly locale: 'en_US' | 'zh_Hans' | 'zh_Hant';
  readonly appTheme: string;
  readonly defaultToolbar: readonly string[];
  readonly placeholder: string;
  readonly isDarkTheme: (theme: string) => boolean;
  readonly localResourceBase: (baseDir: string) => string;
  readonly onUpload: (tab: TTab, files: File[]) => Promise<string | null>;
  readonly callbacks: Pick<VditorOptions, 'after' | 'input' | 'blur'>;
}

export function effectiveToolbarItems(
  toolbarItems: readonly string[] | undefined,
  defaultToolbar: readonly string[],
): string[] {
  const configured = toolbarItems?.length ? toolbarItems : defaultToolbar;
  // Vditor 3.11.3 mode transitions still address this internal toolbar item.
  return configured.includes('outline') ? [...configured] : [...configured, 'outline'];
}

export function createEditorOptions<TTab extends EditorOptionsTab>(
  tab: TTab,
  dependencies: EditorOptionsDependencies<TTab>,
): VditorOptions {
  const { settings } = dependencies;
  const lang =
    dependencies.locale === 'zh_Hans'
      ? 'zh_CN'
      : dependencies.locale === 'zh_Hant'
        ? 'zh_TW'
        : 'en_US';
  return {
    value: tab.content,
    mode: tab.mode,
    theme: dependencies.isDarkTheme(dependencies.appTheme || settings.theme) ? 'dark' : 'classic',
    lang,
    icon: settings.iconSet,
    cdn: 'app://app/vditor',
    height: '100%',
    width: '100%',
    minHeight: 300,
    placeholder: settings.placeholder || dependencies.placeholder,
    typewriterMode: settings.typewriterMode,
    tab: settings.tabInsertSpaces ? ' '.repeat(Number(settings.tabSize) || 4) : '\t',
    rtl: settings.rtl,
    toolbar: effectiveToolbarItems(settings.toolbarItems, dependencies.defaultToolbar),
    toolbarConfig: { hide: false, pin: false },
    outline: { enable: false, position: 'left' },
    link: { isOpen: false },
    cache: { enable: false },
    undoDelay: 500,
    preview: {
      mode: settings.previewMode,
      delay: settings.previewDelay,
      maxWidth: settings.previewMaxWidth,
      actions: settings.multiPlatformPreview
        ? ['desktop', 'tablet', 'mobile', 'mp-wechat', 'zhihu']
        : [],
      hljs: {
        enable: settings.enableHighlight,
        lineNumber: settings.lineNumbers,
        style: settings.codeTheme,
      },
      math: { engine: settings.mathEngine },
      markdown: {
        autoSpace: settings.enableAutoSpace,
        callout: settings.enableCallout,
        footnotes: settings.enableFootnotes,
        imageCaption: settings.enableImageCaption,
        mark: settings.enableMark,
        sub: settings.enableSub,
        sup: settings.enableSup,
        toc: settings.toc,
        paragraphBeginningSpace: settings.paragraphBeginningSpace,
        fixTermTypo: settings.fixTermTypo,
        gfmAutoLink: settings.gfmAutoLink,
        linkBase: dependencies.localResourceBase(tab.baseDir),
        listStyle: settings.listStyle,
        sanitize: settings.sanitize,
        codeBlockPreview: true,
        mathBlockPreview: true,
      },
      theme: { current: settings.contentTheme, path: 'app://app/vditor/dist/css/content-theme' },
    },
    upload: { accept: 'image/*', handler: (files) => dependencies.onUpload(tab, files) },
    ...dependencies.callbacks,
  };
}
