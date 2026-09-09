import { describe, expect, it, vi } from 'vitest';
import { SettingsPersistence } from '../../../src/renderer/settings/settings-persistence';

describe('SettingsPersistence', () => {
  it('separates preference and persistent-state saves without overwriting the other snapshot', async () => {
    let current = { theme: 'light', sidebarWidth: 240, session: 'old' };
    const savePreferences = vi.fn(async (settings) => ({ ...settings, sidebarWidth: 200 }));
    const savePersistentState = vi.fn(async (settings) => ({ ...settings, theme: 'dark' }));
    const persistence = new SettingsPersistence({
      persistentKeys: new Set(['sidebarWidth', 'session']),
      savePreferences,
      savePersistentState,
      getCurrent: () => current,
      setCurrent: (next) => {
        current = next;
      },
      onFailure: vi.fn(),
    });

    await expect(
      persistence.save({ theme: 'dark', sidebarWidth: 320, session: 'new' }),
    ).resolves.toEqual({
      theme: 'dark',
      sidebarWidth: 320,
      session: 'new',
    });
    expect(savePreferences).toHaveBeenCalledWith({ theme: 'dark' });
    expect(savePersistentState).toHaveBeenCalledWith({ sidebarWidth: 320, session: 'new' });
  });

  it('serializes later writes after a failed save and returns current state for recoverable failures', async () => {
    let current = { theme: 'light' };
    const failure = new Error('disk failed');
    const savePreferences = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockImplementationOnce(async (settings) => settings);
    const onFailure = vi.fn();
    const persistence = new SettingsPersistence({
      persistentKeys: new Set<string>(),
      savePreferences,
      savePersistentState: vi.fn(),
      getCurrent: () => current,
      setCurrent: (next) => {
        current = next;
      },
      onFailure,
    });

    await expect(persistence.save({ theme: 'dark' })).resolves.toEqual({ theme: 'light' });
    await expect(persistence.save({ theme: 'dark' }, true)).resolves.toEqual({ theme: 'dark' });
    expect(onFailure).toHaveBeenCalledWith(failure);
  });

  it('exposes failures to callers that require transactional settings persistence', async () => {
    const failure = new Error('disk failed');
    const persistence = new SettingsPersistence({
      persistentKeys: new Set<string>(),
      savePreferences: vi.fn(async () => {
        throw failure;
      }),
      savePersistentState: vi.fn(),
      getCurrent: () => ({ theme: 'light' }),
      setCurrent: vi.fn(),
      onFailure: vi.fn(),
    });
    await expect(persistence.save({ theme: 'dark' }, true)).rejects.toBe(failure);
  });
});
