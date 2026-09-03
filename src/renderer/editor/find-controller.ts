import type { EditMode } from '../state/types.js';

interface FindMatch {
  readonly start: number;
  readonly end: number;
}

export interface FindRuntime {
  readonly id: string;
  readonly content: string;
  readonly host: HTMLElement;
  readonly mode: EditMode;
  focus(): void;
}

export interface FindControllerOptions {
  readonly widget: HTMLElement;
  readonly input: HTMLInputElement;
  readonly replaceInput: HTMLInputElement;
  readonly replaceRow: HTMLElement;
  readonly toggleReplace: HTMLButtonElement;
  readonly count: HTMLElement;
  readonly getActiveRuntime: () => FindRuntime | null;
  readonly adapter: {
    revealTextMatch(host: HTMLElement, mode: EditMode, query: string, occurrence: number): boolean;
    selectTextMatch(host: HTMLElement, mode: EditMode, query: string, occurrence: number): boolean;
    replaceTextMatch(
      host: HTMLElement,
      mode: EditMode,
      query: string,
      occurrence: number,
      replacement: string,
    ): boolean;
    clearFindHighlights(): void;
  };
  readonly onSave: () => void;
}

/** Owns find widget state, its delayed reveal, and its window-level shortcuts. */
export class FindController {
  private readonly widget: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly replaceInput: HTMLInputElement;
  private readonly replaceRow: HTMLElement;
  private readonly toggleReplaceButton: HTMLButtonElement;
  private readonly count: HTMLElement;
  private readonly getActiveRuntime: () => FindRuntime | null;
  private readonly adapter: FindControllerOptions['adapter'];
  private readonly onSave: () => void;
  private matches: FindMatch[] = [];
  private activeIndex = -1;
  private query = '';
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;

  constructor(options: FindControllerOptions) {
    this.widget = options.widget;
    this.input = options.input;
    this.replaceInput = options.replaceInput;
    this.replaceRow = options.replaceRow;
    this.toggleReplaceButton = options.toggleReplace;
    this.count = options.count;
    this.getActiveRuntime = options.getActiveRuntime;
    this.adapter = options.adapter;
    this.onSave = options.onSave;
  }

  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.toggleReplaceButton.addEventListener('click', this.onToggleReplace);
    this.input.addEventListener('input', this.onInput);
    this.widget.addEventListener('focusout', this.onFocusOut);
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  dispose(): void {
    if (!this.initialized) return;
    this.initialized = false;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.toggleReplaceButton.removeEventListener('click', this.onToggleReplace);
    this.input.removeEventListener('input', this.onInput);
    this.widget.removeEventListener('focusout', this.onFocusOut);
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.adapter.clearFindHighlights();
  }

  isVisible(): boolean {
    return !this.widget.classList.contains('hidden');
  }

  open(): void {
    const runtime = this.getActiveRuntime();
    if (!runtime) return;
    const selection = window.getSelection()?.toString() ?? '';
    this.widget.classList.remove('hidden');
    if (selection && !selection.includes('\n')) this.input.value = selection;
    this.refresh(false, false);
    this.input.focus();
    this.input.select();
  }

  close(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    const runtime = this.getActiveRuntime();
    if (runtime && this.activeIndex >= 0 && this.input.value) {
      this.adapter.selectTextMatch(runtime.host, runtime.mode, this.input.value, this.activeIndex);
    }
    this.widget.classList.add('hidden');
    this.adapter.clearFindHighlights();
    runtime?.focus();
  }

  refresh(preserveIndex = true, reveal = true): void {
    const runtime = this.getActiveRuntime();
    const query = this.input.value;
    const previousIndex = this.activeIndex;
    this.query = query;
    this.matches = runtime ? collectMatches(runtime.content, query) : [];
    if (!this.matches.length) this.activeIndex = -1;
    else if (preserveIndex && previousIndex >= 0)
      this.activeIndex = Math.min(previousIndex, this.matches.length - 1);
    else this.activeIndex = 0;
    this.renderCount();
    if (reveal) this.reveal();
  }

  onRuntimeChanged(): void {
    if (this.isVisible()) this.refresh(false);
  }

  replaceOne(): void {
    const runtime = this.getActiveRuntime();
    if (!runtime || this.activeIndex < 0) return;
    const index = this.activeIndex;
    if (
      !this.adapter.replaceTextMatch(
        runtime.host,
        runtime.mode,
        this.query,
        index,
        this.replaceInput.value,
      )
    )
      return;
    window.setTimeout(() => this.refreshAt(index), 0);
  }

  replaceAll(): void {
    const runtime = this.getActiveRuntime();
    if (!runtime || !this.matches.length) return;
    for (let index = this.matches.length - 1; index >= 0; index -= 1) {
      this.adapter.replaceTextMatch(
        runtime.host,
        runtime.mode,
        this.query,
        index,
        this.replaceInput.value,
      );
    }
    window.setTimeout(() => this.refresh(false), 0);
  }

  move(direction: number): void {
    if (!this.matches.length) return;
    this.activeIndex = (this.activeIndex + direction + this.matches.length) % this.matches.length;
    this.renderCount();
    this.reveal();
  }

  private refreshAt(index: number): void {
    this.refresh(true);
    if (this.matches.length) this.activeIndex = Math.min(index, this.matches.length - 1);
    this.renderCount();
    this.reveal();
  }

  private reveal(): void {
    const runtime = this.getActiveRuntime();
    if (!runtime || this.activeIndex < 0 || !this.query) return;
    this.adapter.revealTextMatch(runtime.host, runtime.mode, this.query, this.activeIndex);
  }

  private renderCount(): void {
    this.count.textContent = `${this.activeIndex < 0 ? 0 : this.activeIndex + 1} / ${this.matches.length}`;
  }

  private readonly onToggleReplace = (): void => {
    const expanded = this.replaceRow.classList.toggle('hidden') === false;
    this.toggleReplaceButton.setAttribute('aria-expanded', String(expanded));
    if (expanded) this.replaceInput.focus();
  };

  private readonly onInput = (): void => {
    const changed = this.input.value !== this.query;
    this.refresh(!changed, false);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      if (this.isVisible() && this.input.value === this.query) this.reveal();
    }, 120);
  };

  private readonly onFocusOut = (): void => {
    requestAnimationFrame(() => {
      if (this.isVisible() && !this.widget.contains(document.activeElement)) {
        this.input.focus({ preventScroll: true });
      }
    });
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.isVisible() || !this.widget.contains(event.target as Node)) return;
    event.stopImmediatePropagation();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.onSave();
    } else if (event.key === 'F3') {
      event.preventDefault();
      this.move(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Enter' && event.target === this.input) {
      event.preventDefault();
      this.move(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Enter' && event.target === this.replaceInput) {
      event.preventDefault();
      this.replaceOne();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    }
  };
}

function collectMatches(content: string, query: string): FindMatch[] {
  if (!query) return [];
  const haystack = content.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  const matches: FindMatch[] = [];
  let offset = 0;
  while (offset <= haystack.length - needle.length) {
    const start = haystack.indexOf(needle, offset);
    if (start < 0) break;
    matches.push({ start, end: start + query.length });
    offset = start + Math.max(query.length, 1);
  }
  return matches;
}
