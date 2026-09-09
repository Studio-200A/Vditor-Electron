import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsRuntimeController } from '../../../src/renderer/settings/settings-runtime-controller';

describe('SettingsRuntimeController', () => {
  let dom: JSDOM;

  beforeEach(() => {
    dom = new JSDOM(`<!doctype html><form>
      <input name="uiZoom" type="number" value="100" />
      <input name="editorZoom" type="number" value="100" />
      <select name="locale"><option value="en_US">English</option><option value="zh_Hans">Chinese</option></select>
      <input name="workspaceReadDepth" type="range" value="7" />
      <select name="previewMode"><option value="both">Both</option><option value="editor">Editor</option></select>
      <input name="sanitize" type="checkbox" checked />
      <input name="lightTheme" value="classic" />
      <input name="darkTheme" value="dark" />
      <input name="codeTheme" value="github" />
      <input name="query" type="text" value="" />
    </form>`);
    vi.stubGlobal('HTMLInputElement', dom.window.HTMLInputElement);
    vi.stubGlobal('HTMLSelectElement', dom.window.HTMLSelectElement);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function createController(
    current: Record<string, unknown>,
    savePatch = vi.fn(async (patch: Record<string, unknown>) => Object.assign(current, patch)),
  ) {
    const effects = {
      reloadImages: vi.fn(),
      applyLocale: vi.fn(),
      setWorkspaceWatch: vi.fn().mockResolvedValue(undefined),
      refreshWorkspaceTree: vi.fn().mockResolvedValue(undefined),
      applyPresentation: vi.fn(),
      applyTheme: vi.fn().mockResolvedValue(undefined),
      applyLiveEditorSettings: vi.fn(),
      rebuildEditors: vi.fn(),
      refreshToolbarPreview: vi.fn(),
      showMessage: vi.fn(),
      closeWindow: vi.fn().mockResolvedValue(undefined),
      showConfirmDialog: vi.fn().mockResolvedValue('confirm'),
    };
    const controller = new SettingsRuntimeController({
      form: dom.window.document.querySelector('form') as HTMLFormElement,
      settingsController: { savePatch },
      getSettings: () => current,
      getDefaultSettings: () => current,
      initializationSettings: new Set(['sanitize']),
      getAppliedTheme: () => 'classic',
      isDarkTheme: (theme) => theme === 'dark',
      preferredCodeTheme: () => 'github',
      syncCodeThemeSelect: vi.fn(),
      syncPreviewZoomVisibility: vi.fn(),
      syncEditorTextWidthValue: vi.fn(),
      syncWorkspaceReadDepthValue: vi.fn(),
      restoreDialogLayout: vi.fn(),
      openWindow: vi.fn(),
      closeWindow: effects.closeWindow,
      showConfirmDialog: effects.showConfirmDialog,
      translate: (key) => key,
      showMessage: effects.showMessage,
      errorMessage: () => 'save failed',
      reloadImages: effects.reloadImages,
      applyLocale: effects.applyLocale,
      hasWorkspace: () => true,
      setWorkspaceWatch: effects.setWorkspaceWatch,
      refreshWorkspaceTree: effects.refreshWorkspaceTree,
      applyPresentation: effects.applyPresentation,
      resolveTheme: vi.fn().mockResolvedValue('classic'),
      applyTheme: effects.applyTheme,
      applyLiveEditorSettings: effects.applyLiveEditorSettings,
      rebuildEditors: effects.rebuildEditors,
      refreshToolbarPreview: effects.refreshToolbarPreview,
    });
    return { controller, effects, savePatch };
  }

  it('dispatches classified runtime effects without rebuilding for presentation-only changes', async () => {
    const current = {
      uiZoom: 100,
      locale: 'en_US',
      workspaceReadDepth: 7,
      previewMode: 'both',
      sanitize: true,
      systemTheme: false,
      theme: 'classic',
      lightTheme: 'classic',
      darkTheme: 'dark',
      codeTheme: 'github',
      lightCodeTheme: 'github',
      darkCodeTheme: 'github-dark',
    };
    const { controller, effects } = createController(current);
    (dom.window.document.querySelector('[name="uiZoom"]') as HTMLInputElement).value = '125';

    await controller.save(false);

    expect(effects.applyPresentation).toHaveBeenCalledTimes(1);
    expect(effects.rebuildEditors).not.toHaveBeenCalled();
    expect(effects.applyTheme).toHaveBeenCalledWith('classic');
    expect(effects.showMessage).toHaveBeenCalledWith('message.settingsSaved');
  });

  it('applies editor zoom without rebuilding the editor', async () => {
    const current = {
      uiZoom: 100,
      editorZoom: 100,
      locale: 'en_US',
      workspaceReadDepth: 7,
      previewMode: 'both',
      sanitize: true,
      systemTheme: false,
      theme: 'classic',
      lightTheme: 'classic',
      darkTheme: 'dark',
      codeTheme: 'github',
      lightCodeTheme: 'github',
      darkCodeTheme: 'github-dark',
    };
    const { controller, effects } = createController(current);
    (dom.window.document.querySelector('[name="editorZoom"]') as HTMLInputElement).value = '125';

    await controller.save(false);

    expect(effects.applyPresentation).toHaveBeenCalledOnce();
    expect(effects.rebuildEditors).not.toHaveBeenCalled();
  });

  it('dispatches locale, workspace, live-editor, and rebuild effects after a successful save', async () => {
    const current = {
      uiZoom: 100,
      locale: 'en_US',
      workspaceReadDepth: 7,
      previewMode: 'both',
      sanitize: true,
      systemTheme: false,
      theme: 'classic',
      lightTheme: 'classic',
      darkTheme: 'dark',
      codeTheme: 'github',
      lightCodeTheme: 'github',
      darkCodeTheme: 'github-dark',
    };
    const { controller, effects } = createController(current);
    (dom.window.document.querySelector('[name="locale"]') as HTMLSelectElement).value = 'zh_Hans';
    (dom.window.document.querySelector('[name="workspaceReadDepth"]') as HTMLInputElement).value =
      '8';
    (dom.window.document.querySelector('[name="previewMode"]') as HTMLSelectElement).value =
      'editor';
    (dom.window.document.querySelector('[name="sanitize"]') as HTMLInputElement).checked = false;

    await controller.save(false);

    expect(effects.applyLocale).toHaveBeenCalledWith('zh_Hans');
    expect(effects.setWorkspaceWatch).toHaveBeenCalledWith(8);
    expect(effects.refreshWorkspaceTree).toHaveBeenCalledTimes(1);
    expect(effects.applyLiveEditorSettings).toHaveBeenCalledWith(
      expect.arrayContaining(['previewMode']),
    );
    expect(effects.rebuildEditors).toHaveBeenCalledTimes(1);
  });

  it('reports save failures and cancels pending live-save timers on disposal', async () => {
    vi.useFakeTimers();
    const current = {
      uiZoom: 100,
      locale: 'en_US',
      workspaceReadDepth: 7,
      previewMode: 'both',
      sanitize: true,
      systemTheme: false,
      theme: 'classic',
      lightTheme: 'classic',
      darkTheme: 'dark',
      codeTheme: 'github',
      lightCodeTheme: 'github',
      darkCodeTheme: 'github-dark',
    };
    const rejectedSave = vi.fn().mockRejectedValue(new Error('disk failed'));
    const { controller, effects, savePatch } = createController(current, rejectedSave);

    await controller.save(false);
    expect(effects.showMessage).toHaveBeenCalledWith('save failed', true);

    const input = dom.window.document.querySelector('[name="query"]') as HTMLInputElement;
    input.value = 'pending';
    await controller.scheduleLiveSave({ target: input } as Event);
    controller.dispose();
    await vi.advanceTimersByTimeAsync(250);

    expect(savePatch).toHaveBeenCalledTimes(1);
  });

  it('restores dangerous settings when their confirmation is declined', async () => {
    const current = {
      uiZoom: 100,
      locale: 'en_US',
      workspaceReadDepth: 7,
      previewMode: 'both',
      sanitize: true,
      systemTheme: false,
      theme: 'classic',
      lightTheme: 'classic',
      darkTheme: 'dark',
      codeTheme: 'github',
      lightCodeTheme: 'github',
      darkCodeTheme: 'github-dark',
    };
    const { controller, effects, savePatch } = createController(current);
    effects.showConfirmDialog.mockResolvedValue('cancel');
    const sanitize = dom.window.document.querySelector('[name="sanitize"]') as HTMLInputElement;
    sanitize.checked = false;

    await controller.scheduleLiveSave({ target: sanitize } as Event);

    expect(sanitize.checked).toBe(true);
    expect(savePatch).not.toHaveBeenCalled();
  });

  it('saves select changes immediately', async () => {
    vi.useFakeTimers();
    const current = {
      uiZoom: 100,
      locale: 'en_US',
      workspaceReadDepth: 7,
      previewMode: 'both',
      sanitize: true,
      systemTheme: false,
      theme: 'classic',
      lightTheme: 'classic',
      darkTheme: 'dark',
      codeTheme: 'github',
      lightCodeTheme: 'github',
      darkCodeTheme: 'github-dark',
    };
    const { controller, savePatch } = createController(current);
    const locale = dom.window.document.querySelector('[name="locale"]') as HTMLSelectElement;
    locale.value = 'zh_Hans';

    await controller.scheduleLiveSave({ target: locale } as Event);
    await vi.runAllTimersAsync();

    expect(savePatch).toHaveBeenCalledTimes(1);
    expect(current.locale).toBe('zh_Hans');
  });
});
