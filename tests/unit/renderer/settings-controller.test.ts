import { describe, expect, it, vi } from 'vitest';
import { AppStore } from '../../../src/renderer/state/store';
import { VDITOR_INITIALIZATION_SETTINGS } from '../../../src/renderer/editor/editor-options';
import {
  classifySettingsChange,
  SettingsController,
} from '../../../src/renderer/settings/settings-controller';

const settings = { editMode: 'wysiwyg' as const, locale: 'en_US', uiZoom: 100 };

describe('classifySettingsChange', () => {
  it('keeps presentation-only changes out of the editor rebuild set', () => {
    const change = classifySettingsChange(
      settings,
      { ...settings, uiZoom: 125 },
      VDITOR_INITIALIZATION_SETTINGS,
    );

    expect(change.impacts).toContain('presentation');
    expect(change.shouldRebuildEditor).toBe(false);
  });

  it('identifies constructor-only settings independently from live preview settings', () => {
    const rebuild = classifySettingsChange(
      settings,
      { ...settings, sanitize: false },
      VDITOR_INITIALIZATION_SETTINGS,
    );
    const preview = classifySettingsChange(
      settings,
      { ...settings, previewMode: 'editor' },
      VDITOR_INITIALIZATION_SETTINGS,
    );

    expect(rebuild.shouldRebuildEditor).toBe(true);
    expect(rebuild.impacts).toContain('rebuild-editor');
    expect(preview.shouldRebuildEditor).toBe(false);
    expect(preview.impacts).toContain('live-editor');
  });
});

describe('SettingsController', () => {
  it('keeps settings and defaults in the AppStore after loading and saving', async () => {
    const store = new AppStore();
    const saved = { ...settings, uiZoom: 125 };
    const controller = new SettingsController({
      store,
      save: vi.fn().mockResolvedValue(saved),
    });

    controller.load(settings, { ...settings, uiZoom: 90 });
    await controller.savePatch({ uiZoom: 125 });

    expect(store.getState().defaultSettings).toEqual({ ...settings, uiZoom: 90 });
    expect(store.getState().settings).toEqual(saved);
  });
});
