import { describe, expect, it } from 'vitest';
import {
  parseAbsolutePath,
  parseBinary,
  parseFileName,
  parseFiniteNumber,
  parseSettingsPatch,
  requireArgumentCount,
} from '../../src/main/ipc-validation';

describe('IPC request validation', () => {
  it('accepts bounded absolute paths and rejects malformed path inputs', () => {
    expect(parseAbsolutePath('/notes/readme.md')).toBe('/notes/readme.md');
    expect(() => parseAbsolutePath('notes/readme.md')).toThrow('IPC_INVALID_ARGUMENT');
    expect(() => parseAbsolutePath('/notes\0readme.md')).toThrow('IPC_INVALID_ARGUMENT');
  });

  it('rejects separators, reserved names, and platform-invalid item names', () => {
    expect(parseFileName('notes.md')).toBe('notes.md');
    for (const name of ['../notes.md', 'folder/name.md', 'folder\\name.md', 'CON', 'draft.']) {
      expect(() => parseFileName(name)).toThrow('IPC_INVALID_ARGUMENT');
    }
  });

  it('enforces numeric, argument-count, and binary payload bounds before side effects', () => {
    expect(parseFiniteNumber(125, 75, 200)).toBe(125);
    expect(() => parseFiniteNumber(Infinity, 75, 200)).toThrow('IPC_INVALID_ARGUMENT');
    expect(() => parseFiniteNumber(250, 75, 200)).toThrow('IPC_INVALID_ARGUMENT');
    expect(() => requireArgumentCount(['one', 'two'], 1)).toThrow('IPC_INVALID_ARGUMENT');
    expect(parseBinary(new Uint8Array([1, 2, 3]))).toEqual(new Uint8Array([1, 2, 3]));
    expect(() => parseBinary({ byteLength: 3 })).toThrow('IPC_INVALID_ARGUMENT');
  });

  it('accepts known settings fields with valid nested structures', () => {
    expect(
      parseSettingsPatch({
        locale: 'zh_Hans',
        editMode: 'sv',
        workspaceReadDepth: 12,
        toolbarConfig: { hide: true, pin: false },
        session: { workspacePath: '', activeFilePath: null, openFiles: [] },
      }),
    ).toEqual({
      locale: 'zh_Hans',
      editMode: 'sv',
      workspaceReadDepth: 12,
      toolbarConfig: { hide: true, pin: false },
      session: { workspacePath: '', activeFilePath: null, openFiles: [] },
    });
  });

  it('rejects unknown, malformed, and out-of-range settings before persistence', () => {
    for (const patch of [
      { unknownSetting: true },
      { editMode: 'source' },
      { workspaceReadDepth: 99 },
      { toolbarConfig: { hide: true, unsafe: true } },
      { recentFiles: [{ path: 'relative.md', title: 'relative', openedAt: 1 }] },
    ]) {
      expect(() => parseSettingsPatch(patch)).toThrow('IPC_INVALID_ARGUMENT');
    }
  });
});
