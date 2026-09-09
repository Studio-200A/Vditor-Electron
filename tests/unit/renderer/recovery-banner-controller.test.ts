// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecoveryBannerController } from '../../../src/renderer/editor/recovery-banner-controller.js';

interface TestTab {
  id: string;
  recoveryState: 'unchanged' | 'changed' | 'unavailable' | null;
}

describe('RecoveryBannerController', () => {
  let activeTab: TestTab | null;
  let onSave: ReturnType<typeof vi.fn>;
  let onSaveAs: ReturnType<typeof vi.fn>;
  let onDiscard: ReturnType<typeof vi.fn>;
  let controller: RecoveryBannerController<TestTab>;
  let banner: HTMLElement;
  let message: HTMLElement;
  let detail: HTMLElement;
  let saveButton: HTMLButtonElement;
  let saveAsButton: HTMLButtonElement;
  let discardButton: HTMLButtonElement;

  beforeEach(() => {
    activeTab = null;
    onSave = vi.fn();
    onSaveAs = vi.fn();
    onDiscard = vi.fn();
    banner = document.createElement('section');
    message = document.createElement('p');
    detail = document.createElement('p');
    saveButton = document.createElement('button');
    saveAsButton = document.createElement('button');
    discardButton = document.createElement('button');
    controller = new RecoveryBannerController({
      banner,
      message,
      detail,
      saveButton,
      saveAsButton,
      discardButton,
      getActiveTab: () => activeTab,
      translate: (key) => key,
      onSave,
      onSaveAs,
      onDiscard,
    });
  });

  it('renders recovery state and allows direct save only for unchanged disk content', () => {
    controller.render({ id: 'one', recoveryState: 'unchanged' });

    expect(banner.classList.contains('hidden')).toBe(false);
    expect(message.textContent).toBe('recovery.restored');
    expect(detail.textContent).toBe('recovery.restoredDetail');
    expect(saveButton.classList.contains('hidden')).toBe(false);

    controller.render({ id: 'one', recoveryState: 'changed' });
    expect(message.textContent).toBe('recovery.changed');
    expect(detail.textContent).toBe('recovery.changedDetail');
    expect(saveButton.classList.contains('hidden')).toBe(true);
  });

  it('routes actions only for the active recovered tab and removes listeners on disposal', () => {
    activeTab = { id: 'one', recoveryState: 'unavailable' };

    saveButton.click();
    saveAsButton.click();
    discardButton.click();
    expect(onSave).toHaveBeenCalledWith(activeTab);
    expect(onSaveAs).toHaveBeenCalledWith(activeTab);
    expect(onDiscard).toHaveBeenCalledWith(activeTab);

    controller.dispose();
    saveAsButton.click();
    expect(onSaveAs).toHaveBeenCalledTimes(1);
  });
});
