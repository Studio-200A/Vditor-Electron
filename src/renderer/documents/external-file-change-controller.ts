import type { FileChangedEvent } from '../types/bridges.js';
import type { ExternalChangeController } from './external-change-controller.js';

export interface ExternalChangeTab {
  readonly id: string;
  readonly title: string;
  readonly filePath: string | null;
  readonly fileIdentity: string | null;
  readonly expectedSavedContent: string;
  readonly modified: boolean;
  readonly externalChangeIgnored: boolean;
  readonly externalConflict: { readonly version: number } | null;
  readonly externalFileState: {
    readonly kind: 'deleted' | 'reappeared' | 'unreadable';
    readonly clipboardContent?: string;
    readonly version: number;
  } | null;
  readonly encoding: string;
}

export interface ExternalFileChangeControllerOptions<TTab extends ExternalChangeTab> {
  readonly fileIdentity: (path: string) => Promise<string | null>;
  readonly findTabsByIdentity: (identity: string | null) => readonly TTab[];
  readonly classify: ExternalChangeController['classify'];
  readonly handleWorkspaceChange: (change: FileChangedEvent) => Promise<void>;
  readonly preserveUnavailable: (
    tab: TTab,
    kind: 'deleted' | 'unreadable',
    path: string,
    error?: string,
  ) => Promise<void>;
  readonly beginExternalChange: (tab: TTab) => void;
  readonly clearExternalConflict: (tab: TTab) => void;
  readonly setExternalChangeIgnored: (tab: TTab, ignored: boolean) => void;
  readonly setReappeared: (
    tab: TTab,
    state: { path: string; identity: string | null; content: string; encoding: string },
  ) => void;
  readonly reloadCleanDocument: (tab: TTab, content: string, encoding: string) => void;
  readonly createConflict: (
    tab: TTab,
    state: { path: string; identity: string | null; content: string; encoding: string },
  ) => void;
  readonly isActive: (tab: TTab) => boolean;
  readonly onReloaded: (tab: TTab) => void;
  readonly finish: () => void;
}

/** Owns watcher-event routing while document state mutations remain injected commands. */
export class ExternalFileChangeController<TTab extends ExternalChangeTab> {
  constructor(private readonly options: ExternalFileChangeControllerOptions<TTab>) {}

  async handle(change: FileChangedEvent): Promise<void> {
    if (!isHandledChange(change.event)) return;
    if (change.scope === 'workspace') {
      await this.options.handleWorkspaceChange(change);
      return;
    }
    const identity = change.identity || (await this.options.fileIdentity(change.path));
    for (const tab of this.options.findTabsByIdentity(identity)) {
      await this.applyToTab(tab, change, identity);
    }
    this.options.finish();
  }

  private async applyToTab(
    tab: TTab,
    change: FileChangedEvent,
    identity: string | null,
  ): Promise<void> {
    if (change.event === 'unlink') {
      await this.options.preserveUnavailable(tab, 'deleted', change.path);
      return;
    }
    if (change.event === 'unreadable') {
      await this.options.preserveUnavailable(tab, 'unreadable', change.path, change.error);
      return;
    }
    if (typeof change.content !== 'string') return;
    const encoding = change.encoding || tab.encoding;
    const decision = this.options.classify({
      hasUnavailableState: Boolean(tab.externalFileState),
      expectedSavedContent: tab.expectedSavedContent,
      modified: tab.modified,
      externalChangeIgnored: tab.externalChangeIgnored,
      hasFilePath: Boolean(tab.filePath),
      content: change.content,
    });
    if (decision === 'reappeared') {
      this.options.beginExternalChange(tab);
      this.options.clearExternalConflict(tab);
      this.options.setExternalChangeIgnored(tab, false);
      this.options.setReappeared(tab, {
        path: change.path,
        identity,
        content: change.content,
        encoding,
      });
      return;
    }
    if (decision === 'matches-baseline') {
      this.options.clearExternalConflict(tab);
      this.options.setExternalChangeIgnored(tab, false);
      return;
    }
    if (decision === 'reload-clean-document') {
      this.options.reloadCleanDocument(tab, change.content, encoding);
      if (this.options.isActive(tab)) this.options.onReloaded(tab);
      return;
    }
    this.options.beginExternalChange(tab);
    this.options.createConflict(tab, {
      path: change.path,
      identity,
      content: change.content,
      encoding,
    });
    this.options.setExternalChangeIgnored(tab, false);
  }
}

function isHandledChange(event: FileChangedEvent['event']): boolean {
  return ['add', 'change', 'unlink', 'addDir', 'unlinkDir', 'unreadable', 'watch-error'].includes(
    event,
  );
}
