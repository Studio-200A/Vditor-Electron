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
    if (
      !argument.startsWith('file:') &&
      /^[a-z][a-z\d+.-]*:/i.test(argument) &&
      !path.isAbsolute(argument)
    )
      continue;
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
      if (!fs.statSync(candidate).isFile()) continue;
    } catch {
      // Forward missing or inaccessible Markdown paths so the document open flow
      // reports a safe error instead of silently discarding the user's request.
    }
    files.add(path.normalize(candidate));
  }
  return [...files];
}
