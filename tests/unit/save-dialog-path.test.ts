import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveSaveDialogDefaultPath } from '../../src/main/save-dialog-path';

describe('Save dialog default path', () => {
  it('keeps a POSIX absolute default path and ignores the default directory', () => {
    expect(
      resolveSaveDialogDefaultPath('/workspace/file.md', '/workspace', 'untitled.md', path.posix),
    ).toBe('/workspace/file.md');
  });

  it('does not nest the workspace when Save As forwards the current absolute path', () => {
    expect(
      resolveSaveDialogDefaultPath(
        '/home/user/project/tmp',
        '/home/user/project',
        'untitled.md',
        path.posix,
      ),
    ).toBe('/home/user/project/tmp');
  });

  it('keeps a Windows drive absolute default path and ignores the default directory', () => {
    expect(
      resolveSaveDialogDefaultPath(
        'C:\\workspace\\file.md',
        'C:\\workspace',
        'untitled.md',
        path.win32,
      ),
    ).toBe('C:\\workspace\\file.md');
  });

  it('keeps a Windows UNC absolute default path and ignores the default directory', () => {
    expect(
      resolveSaveDialogDefaultPath(
        '\\\\server\\share\\file.md',
        '\\\\server\\share',
        'untitled.md',
        path.win32,
      ),
    ).toBe('\\\\server\\share\\file.md');
  });

  it('resolves a POSIX relative file name against the default directory', () => {
    expect(resolveSaveDialogDefaultPath('notes.md', '/workspace', 'untitled.md', path.posix)).toBe(
      '/workspace/notes.md',
    );
  });

  it('resolves a Windows relative file name against the default directory', () => {
    expect(
      resolveSaveDialogDefaultPath('notes.md', 'C:\\workspace', 'untitled.md', path.win32),
    ).toBe('C:\\workspace\\notes.md');
  });

  it('returns a relative file name unchanged when no default directory exists', () => {
    expect(resolveSaveDialogDefaultPath('notes.md', undefined, 'untitled.md', path.posix)).toBe(
      'notes.md',
    );
  });

  it('prefills the fallback name under the default directory when no default path is given', () => {
    expect(resolveSaveDialogDefaultPath(undefined, '/workspace', 'untitled.md', path.posix)).toBe(
      '/workspace/untitled.md',
    );
    expect(
      resolveSaveDialogDefaultPath(undefined, 'C:\\workspace', 'untitled.md', path.win32),
    ).toBe('C:\\workspace\\untitled.md');
  });

  it('falls back to the bare file name when neither default path nor directory is given', () => {
    expect(resolveSaveDialogDefaultPath(undefined, undefined, undefined, path.posix)).toBe(
      'untitled.md',
    );
  });

  it('honors a custom fallback file name', () => {
    expect(resolveSaveDialogDefaultPath(undefined, '/workspace', 'draft.md', path.posix)).toBe(
      '/workspace/draft.md',
    );
  });

  it('treats an empty default path as absent', () => {
    expect(resolveSaveDialogDefaultPath('', '/workspace', 'untitled.md', path.posix)).toBe(
      '/workspace/untitled.md',
    );
    expect(resolveSaveDialogDefaultPath('', undefined, 'untitled.md', path.posix)).toBe(
      'untitled.md',
    );
  });
});
