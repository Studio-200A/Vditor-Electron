import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractOpenFilePaths } from '../../src/main/open-files';

describe('external Markdown file arguments', () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-open-files-'));
    fs.writeFileSync(path.join(directory, 'first note.md'), '# First');
    fs.writeFileSync(path.join(directory, 'second.markdown'), '# Second');
    fs.writeFileSync(path.join(directory, 'ignored.txt'), 'Text');
  });

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  it('extracts absolute, relative, and file URL Markdown paths without duplicates', () => {
    const first = path.join(directory, 'first note.md');
    const second = path.join(directory, 'second.markdown');
    expect(
      extractOpenFilePaths(
        ['electron', '.', first, 'second.markdown', pathToFileURL(first).href, '--inspect'],
        directory,
      ),
    ).toEqual([first, second]);
  });

  it('ignores missing paths, directories, flags, and unsupported file types', () => {
    expect(
      extractOpenFilePaths(
        ['--ozone-platform=wayland', '.', directory, 'missing.md', 'ignored.txt'],
        directory,
      ),
    ).toEqual([]);
  });
});
