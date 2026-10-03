import type {
  RecreateNoticeKind,
  SaveWorkflowMessageKind,
} from './document-save-external-workflow-controller.js';

interface FeedbackDocument {
  readonly title: string;
}

export interface DocumentFeedbackOptions {
  readonly translate: (key: string, params?: Record<string, string>) => string;
  readonly formatError: (error: unknown) => string;
  readonly showStatus: (message: string, error?: boolean) => void;
  readonly showNotice: (message: string, error?: boolean) => void;
}

const MESSAGE_KEYS: Record<SaveWorkflowMessageKind, string> = {
  saved: 'message.saved',
  'path-open': 'message.savePathAlreadyOpen',
  'resolve-file-state': 'external.resolveFileStateBeforeSave',
  'resolve-conflict': 'external.resolveBeforeSave',
  'changed-again': 'external.changedAgain',
  'permission-denied': 'message.savePermissionDenied',
  'save-failed': 'message.saveFailedGeneric',
  reloaded: 'external.reloaded',
  ignored: 'external.ignored',
  recreated: 'external.recreated',
  'recreated-copied': 'external.recreatedCopied',
  'recreated-clipboard-failed': 'external.recreatedClipboardFailed',
};

const STATUS_RESULTS = new Set<SaveWorkflowMessageKind>([
  'saved',
  'reloaded',
  'ignored',
  'recreated',
  'recreated-copied',
  'recreated-clipboard-failed',
]);

/** Presents document outcomes without owning save transactions or document state. */
export class DocumentFeedback {
  constructor(private readonly options: DocumentFeedbackOptions) {}

  showOpenFailure(error: unknown): void {
    this.options.showNotice(
      this.options.translate('message.openFailed', { error: this.options.formatError(error) }),
      true,
    );
  }

  showSaveResult(kind: SaveWorkflowMessageKind, document: FeedbackDocument, error?: unknown): void {
    const key =
      kind === 'save-failed' && error !== undefined ? 'message.saveFailed' : MESSAGE_KEYS[kind];
    const message = this.options.translate(key, {
      title: document.title,
      name: document.title,
      error: error === undefined ? '' : this.options.formatError(error),
    });
    const isError = !STATUS_RESULTS.has(kind) || kind === 'recreated-clipboard-failed';
    // Recreate results also have a dedicated notice callback after clipboard work completes.
    if (STATUS_RESULTS.has(kind)) this.options.showStatus(message, isError);
    else this.options.showNotice(message, true);
  }

  showRecreateNotice(kind: RecreateNoticeKind): void {
    this.options.showNotice(
      this.options.translate(MESSAGE_KEYS[kind]),
      kind === 'recreated-clipboard-failed',
    );
  }
}
