import type {
  AppState,
  DocumentTab,
  DocumentState,
  EditorRuntime,
  ExternalConflict,
  ExternalFileState,
  RecoveryState,
  AppSettings,
} from './types.js';
import type { SupportedLocale } from '../types/locales.js';

export type Subscriber<T> = (state: T) => void;
export type Unsubscribe = () => void;
export type Selector<T, R> = (state: T) => R;

export class AppStore {
  private _state: AppState;
  private _subscribers = new Set<Subscriber<AppState>>();

  constructor(initialState: Partial<AppState> = {}) {
    this._state = {
      documents: [],
      activeDocumentId: null,
      workspacePath: '',
      settings: null,
      defaultSettings: null,
      locale: 'en_US',
      toolbarPreview: null,
      untitledCounters: { file: 0, directory: 0 },
      workspaceRevision: 0,
      toolbarWrapHeight: 0,
      ...initialState,
    };
  }

  getState(): AppState {
    return this._state;
  }

  subscribe(subscriber: Subscriber<AppState>): Unsubscribe {
    this._subscribers.add(subscriber);
    return () => {
      this._subscribers.delete(subscriber);
    };
  }

  subscribeWithSelector<R>(
    selector: Selector<AppState, R>,
    subscriber: (value: R) => void,
  ): Unsubscribe {
    let previousValue = selector(this._state);
    const unsubscribe = this.subscribe((state) => {
      const newValue = selector(state);
      if (newValue !== previousValue) {
        previousValue = newValue;
        subscriber(newValue);
      }
    });
    return unsubscribe;
  }

  private _notify(): void {
    for (const subscriber of this._subscribers) {
      subscriber(this._state);
    }
  }

  private _updateState(updater: (state: AppState) => AppState): void {
    this._state = updater(this._state);
    this._notify();
  }

  // Document operations
  addDocument(document: DocumentTab): void {
    this._updateState((state) => ({
      ...state,
      documents: [...state.documents, document],
    }));
  }

  removeDocument(id: string): void {
    this._updateState((state) => ({
      ...state,
      documents: state.documents.filter((doc) => doc.id !== id),
      activeDocumentId: state.activeDocumentId === id ? null : state.activeDocumentId,
    }));
  }

  activateDocument(id: string): void {
    this._updateState((state) => ({
      ...state,
      activeDocumentId: state.documents.some((doc) => doc.id === id) ? id : state.activeDocumentId,
    }));
  }

  updateDocument(id: string, updates: Partial<DocumentState>): void {
    this._updateState((state) => ({
      ...state,
      documents: state.documents.map((doc) => (doc.id === id ? { ...doc, ...updates } : doc)),
    }));
  }

  updateDocumentRuntime(id: string, updates: Partial<EditorRuntime>): void {
    this._updateState((state) => ({
      ...state,
      documents: state.documents.map((doc) =>
        doc.id === id ? { ...doc, runtime: { ...doc.runtime, ...updates } } : doc,
      ),
    }));
  }

  getDocument(id: string): DocumentTab | undefined {
    return this._state.documents.find((doc) => doc.id === id);
  }

  getActiveDocument(): DocumentTab | null {
    if (!this._state.activeDocumentId) return null;
    return this.getDocument(this._state.activeDocumentId) ?? null;
  }

  // Settings operations
  updateSettings(settings: AppSettings): void {
    this._updateState((state) => ({
      ...state,
      settings,
    }));
  }

  updateDefaultSettings(settings: AppSettings): void {
    this._updateState((state) => ({
      ...state,
      defaultSettings: settings,
    }));
  }

  // Locale operations
  updateLocale(locale: SupportedLocale): void {
    this._updateState((state) => ({
      ...state,
      locale,
    }));
  }

  // Workspace operations
  updateWorkspacePath(path: string): void {
    this._updateState((state) => ({
      ...state,
      workspacePath: path,
      workspaceRevision: state.workspaceRevision + 1,
    }));
  }

  incrementWorkspaceRevision(): void {
    this._updateState((state) => ({
      ...state,
      workspaceRevision: state.workspaceRevision + 1,
    }));
  }

  // Toolbar preview operations
  setToolbarPreview(preview: DocumentTab | null): void {
    this._updateState((state) => ({
      ...state,
      toolbarPreview: preview,
    }));
  }

  // Untitled counter operations
  incrementUntitledCounter(type: 'file' | 'directory'): number {
    const current = this._state.untitledCounters[type];
    this._updateState((state) => ({
      ...state,
      untitledCounters: {
        ...state.untitledCounters,
        [type]: current + 1,
      },
    }));
    return current + 1;
  }

  getUntitledCounter(type: 'file' | 'directory'): number {
    return this._state.untitledCounters[type];
  }

  // Toolbar wrap height operations
  updateToolbarWrapHeight(height: number): void {
    this._updateState((state) => ({
      ...state,
      toolbarWrapHeight: height,
    }));
  }

  // External conflict operations
  setExternalConflict(id: string, conflict: ExternalConflict | null): void {
    this.updateDocument(id, { externalConflict: conflict });
  }

  setExternalFileState(id: string, fileState: ExternalFileState | null): void {
    this.updateDocument(id, { externalFileState: fileState });
  }

  setExternalChangeIgnored(id: string, ignored: boolean): void {
    this.updateDocument(id, { externalChangeIgnored: ignored });
  }

  // Recovery operations
  setRecoveryState(id: string, recoveryState: RecoveryState | null): void {
    this.updateDocument(id, {
      recoveryState,
      recoverySnapshotId: recoveryState?.snapshotId ?? null,
    });
  }

  incrementRecoveryRevision(id: string): void {
    const doc = this.getDocument(id);
    if (doc) {
      this.updateDocument(id, { recoveryRevision: doc.recoveryRevision + 1 });
    }
  }

  // Content operations
  updateContent(id: string, content: string): void {
    const doc = this.getDocument(id);
    if (doc) {
      this.updateDocument(id, {
        content,
        modified: content !== doc.savedContent,
        contentRevision: doc.contentRevision + 1,
      });
    }
  }

  markContentSaved(id: string, savedContent: string): void {
    this.updateDocument(id, {
      savedContent,
      expectedSavedContent: savedContent,
      modified: false,
    });
  }
}
