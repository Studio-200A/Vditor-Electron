export interface EditorRuntimeCoordinatorTab {
  readonly id: string;
  readonly host: HTMLElement;
  readonly toolbar: HTMLElement | null;
}

export interface EditorRuntimeCoordinatorOptions<TTab extends EditorRuntimeCoordinatorTab> {
  readonly getTab: (id: string) => TTab | null;
  readonly getTabs: () => readonly TTab[];
  readonly getActiveTab: () => TTab | null;
  readonly getActiveDocumentId: () => string | null;
  readonly closeContextMenu: () => void;
  readonly restoreToolbar: (tab: TTab | null) => void;
  readonly activateDocument: (id: string) => void;
  readonly syncToolbarAvailability: () => void;
  readonly ensureEditor: (tab: TTab) => void;
  readonly updateBottomSpacer: (tab: TTab) => void;
  readonly scrollToPendingAnchor: (tab: TTab) => void;
  readonly mountToolbar: (tab: TTab) => void;
  readonly scheduleSplitLineNumbers: (tab: TTab) => void;
  readonly renderTabs: () => void;
  readonly updateActiveUI: () => void;
  readonly onOutlineRuntimeChanged: () => void;
  readonly onFindRuntimeChanged: () => void;
  readonly persistSession: () => void;
}

/** Coordinates tab-scoped editor UI after DocumentController has chosen an active document. */
export class EditorRuntimeCoordinator<TTab extends EditorRuntimeCoordinatorTab> {
  private readonly options: EditorRuntimeCoordinatorOptions<TTab>;

  constructor(options: EditorRuntimeCoordinatorOptions<TTab>) {
    this.options = options;
  }

  activate(id: string): boolean {
    const tab = this.options.getTab(id);
    if (!tab) return false;
    this.options.closeContextMenu();
    this.options.restoreToolbar(this.options.getActiveTab());
    this.options.activateDocument(id);
    this.options.syncToolbarAvailability();
    this.setActiveHost(tab);
    this.options.ensureEditor(tab);
    requestAnimationFrame(() => {
      if (this.options.getActiveDocumentId() !== tab.id) return;
      this.options.updateBottomSpacer(tab);
    });
    requestAnimationFrame(() => {
      if (this.options.getActiveDocumentId() !== tab.id) return;
      this.options.scrollToPendingAnchor(tab);
    });
    if (tab.toolbar) this.options.mountToolbar(tab);
    this.options.scheduleSplitLineNumbers(tab);
    this.options.renderTabs();
    this.options.updateActiveUI();
    this.options.onOutlineRuntimeChanged();
    this.options.onFindRuntimeChanged();
    this.options.persistSession();
    return true;
  }

  private setActiveHost(activeTab: TTab): void {
    for (const tab of this.options.getTabs()) {
      tab.host.classList.toggle('active', tab === activeTab);
    }
  }
}
