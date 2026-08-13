import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKDOWN_EXTENSION = /\.(?:md|markdown|mdown|mkd|mkdn)$/i;

export function extractOpenFilePaths(
  argv: readonly string[],
  workingDirectory: string = process.cwd(),
): string[] {
  const files = new Set<string>();
  for (const argument of argv) {
    if (!argument || argument.startsWith('-')) continue;
    let candidate: string;
    try {
      candidate = argument.startsWith('file:')
        ? fileURLToPath(argument)
        : path.resolve(workingDirectory, argument);
    } catch {
      continue;
    }
    if (!MARKDOWN_EXTENSION.test(candidate)) continue;
    try {
      if (fs.statSync(candidate).isFile()) files.add(path.normalize(candidate));
    } catch {
      // Ignore stale desktop entries and unrelated command-line arguments.
    }
  }
  return [...files];
}
