import type { SupportedLocale } from '../types/locales.js';

export type EditMode = 'wysiwyg' | 'ir' | 'sv';

export interface AppSettings {
  editMode: EditMode;
  locale: string;
  [key: string]: unknown;
}

export interface DocumentIdentity {
  readonly filePath: string | null;
  readonly fileIdentity: string | null;
}

export interface DocumentState extends DocumentIdentity {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly savedContent: string;
  readonly encoding: string;
  readonly lineEnding: 'CRLF' | 'LF';
  readonly baseDir: string;
  readonly modified: boolean;
  readonly expectedSavedContent: string;
  readonly contentRevision: number;
  readonly mode: EditMode;
  readonly externalConflict: ExternalConflict | null;
  readonly externalChangeIgnored: boolean;
  readonly externalFileState: ExternalFileState | null;
  readonly recoverySnapshotId: string | null;
  readonly recoveryState: RecoveryState | null;
  readonly recoveryRevision: number;
}

export interface ExternalConflict {
  readonly kind: 'modified';
  readonly path: string;
  /** Canonical identity captured when the conflicting disk version was read. */
  readonly identity: string | null;
  readonly content?: string;
  readonly encoding: string;
  readonly detectedAt: number;
  readonly version: number;
}

export interface ExternalFileState {
  readonly kind: 'deleted' | 'reappeared' | 'unreadable';
  readonly path: string;
  /** Canonical identity captured when this unavailable state was classified. */
  readonly identity: string | null;
  readonly content?: string;
  readonly encoding?: string;
  readonly error?: string;
  readonly clipboardContent?: string;
  readonly detectedAt: number;
  readonly version: number;
}

export interface EditorRuntime {
  readonly vditor: Vditor | null;
  readonly ready: boolean;
  readonly host: HTMLElement;
  readonly toolbar: HTMLElement | null;
  readonly lineObserver: MutationObserver | null;
  readonly lineResizeObserver: ResizeObserver | null;
  readonly lineNumberFrame: number | null;
  readonly whitespaceFrame: number | null;
  readonly bottomSpacerObserver: ResizeObserver | null;
  readonly outlineCollapsed: Set<string>;
  readonly resourceObserver: MutationObserver | null;
  readonly splitResizer: SplitResizer | null;
  readonly pendingAnchor: string;
  readonly pendingEditorContent: boolean;
}

export interface SplitResizer {
  readonly disconnect: () => void;
}

export interface Vditor {
  destroy(): void;
  disabled(): void;
  getCurrentMode(): EditMode | null;
  setTheme(theme: string, contentTheme: string, codeTheme: string, baseUrl: string): void;
  setPreviewMode(mode: string): void;
  getValue(): string;
  setValue(value: string, clearStack?: boolean): void;
  focus(): void;
  blur(): void;
}

export interface DocumentTab extends DocumentState {
  readonly runtime: EditorRuntime;
}

export type RecoveryState = 'unchanged' | 'changed' | 'unavailable';

export interface AppState {
  readonly documents: readonly DocumentTab[];
  readonly activeDocumentId: string | null;
  readonly workspacePath: string;
  readonly settings: AppSettings | null;
  readonly defaultSettings: AppSettings | null;
  readonly locale: SupportedLocale;
  readonly toolbarPreview: DocumentTab | null;
  readonly untitledCounters: {
    readonly file: number;
    readonly directory: number;
  };
  readonly workspaceRevision: number;
  readonly toolbarWrapHeight: number;
}
