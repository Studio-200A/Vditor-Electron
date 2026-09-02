declare global {
  interface Window {
    Vditor: typeof Vditor;
  }
  var Vditor: typeof import('./vditor').Vditor;
}

export interface VditorOptions {
  mode?: 'wysiwyg' | 'ir' | 'sv';
  theme?: string;
  icon?: 'ant' | 'material';
  lang?: string;
  placeholder?: string;
  typewriterMode?: boolean;
  tab?: string;
  height?: string;
  minHeight?: string;
  width?: string;
  toolbar?: Array<string | { name: string; tipPosition?: string }>;
  cache?: { enable?: boolean; id?: string };
  after?: () => void;
  input?: (value: string) => void;
  blur?: () => void;
  focus?: () => void;
  upload?: {
    url?: string;
    handler?: (files: File[]) => string | false;
    accept?: string;
    max?: number;
    filename?: (name: string) => string;
  };
  preview?: {
    mode?: 'both' | 'editor';
    delay?: number;
    maxWidth?: number;
    markdown?: Record<string, unknown>;
    math?: { engine?: 'KaTeX' | 'MathJax' };
    hljs?: Record<string, unknown>;
    theme?: Record<string, unknown>;
    actions?: string[];
  };
  hint?: Record<string, unknown>;
  outline?: { enable?: boolean; position?: 'left' | 'right' };
  cdn?: string;
  undoDelay?: number;
  counter?: { enable?: boolean; max?: number };
}

export declare class Vditor {
  constructor(element: HTMLElement, options?: VditorOptions);
  getValue(): string;
  setValue(markdown: string, clearStack?: boolean): void;
  getHTML(): string;
  getText(): string;
  focus(): void;
  blur(): void;
  disabled(): void;
  enable(): void;
  destroy(): void;
  setTheme(theme: string, codeTheme?: string, codeThemeAbbr?: string): void;
  setPreviewMode(mode: 'both' | 'editor'): void;
  setOptions(options: Partial<VditorOptions>): void;
  getCurrentMode(): 'wysiwyg' | 'ir' | 'sv';
}
