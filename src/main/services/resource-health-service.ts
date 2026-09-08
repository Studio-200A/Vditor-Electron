import { randomUUID } from 'node:crypto';
import type { Dirent, Stats } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { localResourceContentType } from '../local-resource';

export const RESOURCE_HEALTH_LIMITS = {
  maximumSourceFiles: 5_000,
  maximumSourceFileBytes: 4 * 1024 * 1024,
  maximumSourceBytes: 64 * 1024 * 1024,
  maximumImageEntries: 10_000,
  maximumDurationMs: 30_000,
  previewMaximumBytes: 64 * 1024 * 1024,
} as const;

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn']);
const SOURCE_EXTENSIONS = new Set([...MARKDOWN_EXTENSIONS, '.html', '.htm']);
const EXCLUDED_HIDDEN_SOURCE_DIRECTORIES = new Set(['.cache', '.git', '.hg', '.svn']);
const HTML_ENTITY_CODE_POINTS: Readonly<Record<string, number>> = {
  amp: 38,
  apos: 39,
  gt: 62,
  lt: 60,
  nbsp: 160,
  quot: 34,
};

export type ResourceHealthSkipReason =
  | 'permission-denied'
  | 'read-failed'
  | 'source-file-limit'
  | 'source-file-too-large'
  | 'source-byte-limit'
  | 'image-entry-limit'
  | 'symbolic-link'
  | 'timeout'
  | 'unparseable';

export interface ResourceHealthLimitations {
  readonly complete: boolean;
  readonly skipped: Readonly<Record<ResourceHealthSkipReason, number>>;
}

export interface ResourceHealthCandidate {
  readonly id: string;
  readonly relativePath: string;
  readonly name: string;
  readonly size: number;
  readonly modifiedAt: number;
  readonly previewAvailable: boolean;
}

export interface MissingImageReference {
  readonly targetPath: string;
  readonly source: string;
  readonly locations: readonly { line: number; column: number; raw: string; removable: boolean }[];
}

export interface ResourceHealthScanSummary {
  readonly schemaVersion: 1;
  readonly revision: string;
  readonly documentRelativePath: string;
  readonly imageDirectoryRelativePath: string;
  readonly workspaceName: string;
  readonly savedAt: number;
  readonly completedAt: number;
  readonly scannedSourceFiles: number;
  readonly candidates: readonly ResourceHealthCandidate[];
  readonly missingReferences: readonly MissingImageReference[];
  readonly candidateBytes: number;
  readonly limitations: ResourceHealthLimitations;
}

export type ResourceHealthActionCode =
  | 'trashed'
  | 'revalidated-as-referenced'
  | 'changed-since-scan'
  | 'outside-workspace'
  | 'unsupported'
  | 'scan-incomplete'
  | 'not-found'
  | 'failed';

export interface ResourceHealthActionResult {
  readonly id: string;
  readonly code: ResourceHealthActionCode;
}

export interface ResourceHealthScanInput {
  readonly documentPath: string;
  readonly workspacePath: string;
  readonly pasteImagesDir: string;
  readonly allowSvgImages: boolean;
}

interface StoredCandidate extends ResourceHealthCandidate {
  readonly absolutePath: string;
}

interface StoredScan {
  readonly input: ResourceHealthScanInput;
  readonly summary: ResourceHealthScanSummary;
  readonly candidates: ReadonlyMap<string, StoredCandidate>;
}

interface ExtractedReference {
  readonly source: string;
  readonly raw: string;
  readonly line: number;
  readonly column: number;
  readonly removable: boolean;
}

function isWithin(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function relativeDisplayPath(workspacePath: string, filePath: string): string {
  return path.relative(workspacePath, filePath).split(path.sep).join('/');
}

function isSourcePath(filePath: string): boolean {
  return SOURCE_EXTENSIONS.has(path.extname(filePath).toLocaleLowerCase());
}

function isImagePath(filePath: string, allowSvgImages: boolean): boolean {
  return (
    localResourceContentType(filePath, undefined, allowSvgImages)?.startsWith('image/') ?? false
  );
}

async function hasSupportedImageSignature(
  filePath: string,
  allowSvgImages: boolean,
): Promise<boolean> {
  const contentType = localResourceContentType(filePath, undefined, allowSvgImages);
  if (!contentType) return false;
  let header: Buffer;
  try {
    const handle = await fs.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(512);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      header = buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
  if (contentType === 'image/png' || contentType === 'image/apng')
    return header
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (contentType === 'image/jpeg')
    return header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  if (contentType === 'image/gif')
    return (
      header.subarray(0, 6).equals(Buffer.from('GIF87a')) ||
      header.subarray(0, 6).equals(Buffer.from('GIF89a'))
    );
  if (contentType === 'image/webp')
    return (
      header.subarray(0, 4).equals(Buffer.from('RIFF')) &&
      header.subarray(8, 12).equals(Buffer.from('WEBP'))
    );
  if (contentType === 'image/avif')
    return (
      header.subarray(4, 8).equals(Buffer.from('ftyp')) &&
      /avi[fs]/.test(header.subarray(8, 12).toString('ascii'))
    );
  return (
    contentType === 'image/svg+xml' &&
    /^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(header.toString('utf8'))
  );
}

function stripInlineCode(source: string): string {
  let stripped = '';
  let cursor = 0;
  while (cursor < source.length) {
    if (source[cursor] !== '`') {
      stripped += source[cursor];
      cursor += 1;
      continue;
    }
    let delimiterEnd = cursor + 1;
    while (source[delimiterEnd] === '`') delimiterEnd += 1;
    const delimiter = source.slice(cursor, delimiterEnd);
    const closing = source.indexOf(delimiter, delimiterEnd);
    if (closing < 0 || source.slice(delimiterEnd, closing).includes('\n')) {
      stripped += delimiter;
      cursor = delimiterEnd;
      continue;
    }
    stripped += ' '.repeat(closing + delimiter.length - cursor);
    cursor = closing + delimiter.length;
  }
  return stripped;
}

function stripCode(source: string): string {
  return stripInlineCode(
    source.replace(/^\s*(```|~~~)[\s\S]*?^\s*\1\s*$/gm, (match) => match.replace(/[^\n]/g, ' ')),
  );
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (match, decimal, hex, named) => {
    const codePoint = decimal
      ? Number.parseInt(decimal, 10)
      : hex
        ? Number.parseInt(hex, 16)
        : (HTML_ENTITY_CODE_POINTS[String(named).toLowerCase()] ?? 0);
    if (!codePoint || codePoint > 0x10ffff) return match;
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return match;
    }
  });
}

function hasUnsupportedHtmlEntity(value: string): boolean {
  return /&(?:#\d+|#x[\da-f]+|[a-z]+);/gi.test(
    value.replace(/&(?:#\d+|#x[\da-f]+|amp|apos|gt|lt|nbsp|quot);/gi, ''),
  );
}

function parseSrcset(value: string): readonly string[] | null {
  if (!value || /[()"'<>]/.test(value) || /(?:^|,)\s*data:/i.test(value)) return null;
  const sources: string[] = [];
  for (const candidate of value.split(',')) {
    const match = candidate.trim().match(/^(\S+)(?:\s+(?:\d+(?:\.\d+)?x|\d+w))?$/);
    if (!match) return null;
    sources.push(match[1]);
  }
  return sources.length ? sources : null;
}

function htmlResourceAttributes(
  source: string,
): readonly { name: string; value: string; decodedValue: string; index: number }[] {
  const attributes: { name: string; value: string; decodedValue: string; index: number }[] = [];
  const tags = /<(?:(?:"[^"]*"|'[^']*')|[^'">])*>/g;
  for (const tag of source.matchAll(tags)) {
    const tagSource = tag[0];
    const tagIndex = tag.index ?? 0;
    const attribute =
      /\b(srcset|src|href|xlink:href|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
    for (const match of tagSource.matchAll(attribute)) {
      const value = match[2] ?? match[3] ?? match[4];
      if (value === undefined) continue;
      attributes.push({
        name: match[1].toLocaleLowerCase(),
        value,
        decodedValue: decodeHtmlEntities(value),
        index: tagIndex + (match.index ?? 0) + match[0].indexOf(value),
      });
    }
  }
  return attributes;
}

function isEscaped(source: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) slashCount += 1;
  return slashCount % 2 === 1;
}

function hasAmbiguousLocalReferenceSyntax(source: string): boolean {
  const parseable = stripCode(source);
  const hasUndecodableLocalTarget = (raw: string): boolean => {
    const target = raw.trim().replace(/^<|>$/g, '');
    if (
      !target ||
      target.startsWith('#') ||
      /^data:/i.test(target) ||
      /^[a-z][a-z0-9+.-]*:/i.test(target) ||
      target.startsWith('//')
    )
      return false;
    try {
      decodeURIComponent(target.split(/[?#]/, 1)[0]);
      return false;
    } catch {
      return true;
    }
  };
  const markdownTargets = [
    ...parseable.matchAll(
      /!?(?:\[[^\]]*]\(\s*)(<[^>]+>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g,
    ),
    ...parseable.matchAll(/^\s*\[[^\]]+]:\s*(<[^>]+>|\S+)/gm),
  ];
  // Nested destination parentheses require a Markdown parser. Treat them as incomplete rather
  // than risk presenting an unrecognized local image as safe to trash.
  return (
    /!?\[[^\]]*]\(\s*(?:<[^>]+>|[^\s)]*\([^)]*)/m.test(parseable) ||
    /!?\[[^\n]*\[[^\n]*\][^\n]*\]\s*\(/m.test(parseable) ||
    markdownTargets.some((match) => hasUndecodableLocalTarget(match[1])) ||
    htmlResourceAttributes(parseable).some(
      (attribute) =>
        hasUnsupportedHtmlEntity(attribute.value) ||
        (attribute.name === 'srcset' && !parseSrcset(attribute.decodedValue)) ||
        (attribute.name !== 'srcset' && hasUndecodableLocalTarget(attribute.decodedValue)),
    )
  );
}

function lineAndColumn(source: string, index: number): { line: number; column: number } {
  const prefix = source.slice(0, index);
  const line = prefix.split('\n').length;
  const lineStart = prefix.lastIndexOf('\n');
  return { line, column: index - lineStart };
}

function cleanReference(raw: string): string | null {
  const trimmed = raw.trim().replace(/^<|>$/g, '');
  if (!trimmed || trimmed.startsWith('#') || /^data:/i.test(trimmed)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('//')) return null;
  const withoutSuffix = trimmed.split(/[?#]/, 1)[0];
  if (!withoutSuffix) return null;
  try {
    return decodeURIComponent(withoutSuffix);
  } catch {
    return null;
  }
}

/** Extracts local Markdown/HTML URLs without treating fenced or inline code as links. */
export function extractLocalReferences(source: string): readonly ExtractedReference[] {
  const parseable = stripCode(source);
  const references: ExtractedReference[] = [];
  const add = (raw: string, index: number, reference = raw, removable = true): void => {
    const cleaned = cleanReference(raw);
    if (!cleaned) return;
    const location = lineAndColumn(source, index);
    references.push({ source: cleaned, raw: reference, removable, ...location });
  };

  const markdownInline =
    /!?\[[^\]]*]\(\s*(<[^>]+>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
  for (const match of parseable.matchAll(markdownInline)) {
    const raw = match[1];
    const index = (match.index ?? 0) + match[0].indexOf(raw);
    if (isEscaped(parseable, match.index ?? 0)) continue;
    add(raw, index, match[0]);
  }
  const markdownReference = /^\s*\[[^\]]+]:\s*(<[^>]+>|\S+)/gm;
  for (const match of parseable.matchAll(markdownReference)) {
    const raw = match[1];
    const index = (match.index ?? 0) + match[0].indexOf(raw);
    add(raw, index, match[0]);
  }
  for (const attribute of htmlResourceAttributes(parseable)) {
    if (attribute.name === 'srcset') {
      for (const value of parseSrcset(attribute.decodedValue) ?? [])
        add(value, attribute.index, attribute.value, false);
    } else add(attribute.decodedValue, attribute.index, attribute.value, false);
  }
  return references;
}

export class ResourceHealthService {
  private readonly scans = new Map<string, StoredScan>();
  private scanEpoch = 0;

  /** Returns only an eligibility decision; canonical paths remain main-process data. */
  async isEligible(
    input: Pick<ResourceHealthScanInput, 'documentPath' | 'workspacePath'>,
  ): Promise<boolean> {
    try {
      await this.normalizeDocumentAndWorkspace(input);
      return true;
    } catch {
      return false;
    }
  }

  async scan(input: ResourceHealthScanInput): Promise<ResourceHealthScanSummary> {
    const scanEpoch = ++this.scanEpoch;
    const normalizedInput = await this.normalizeInput(input);
    const startedAt = Date.now();
    const skipped = this.emptySkipped();
    const referencedPaths = new Set<string>();
    const protectedDirectories: string[] = [];
    const missing = new Map<
      string,
      {
        source: string;
        locations: { line: number; column: number; raw: string; removable: boolean }[];
      }
    >();
    let scannedSourceFiles = 0;
    let sourceBytes = 0;
    let stop = false;
    const note = (reason: ResourceHealthSkipReason): void => {
      skipped[reason] += 1;
      stop = true;
    };

    const sourceFiles: string[] = [];
    const visitWorkspace = async (directory: string): Promise<void> => {
      if (stop || Date.now() - startedAt > RESOURCE_HEALTH_LIMITS.maximumDurationMs) {
        if (!stop) note('timeout');
        return;
      }
      let entries: Dirent[];
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch (error) {
        skipped[this.reasonFor(error)] += 1;
        stop = true;
        return;
      }
      for (const entry of entries) {
        if (stop) continue;
        const entryPath = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (!EXCLUDED_HIDDEN_SOURCE_DIRECTORIES.has(entry.name)) await visitWorkspace(entryPath);
        } else if (entry.isFile() && isSourcePath(entryPath)) {
          if (sourceFiles.length >= RESOURCE_HEALTH_LIMITS.maximumSourceFiles) {
            note('source-file-limit');
            return;
          }
          sourceFiles.push(entryPath);
        }
      }
    };
    await visitWorkspace(normalizedInput.workspacePath);

    for (const sourcePath of sourceFiles) {
      if (stop) break;
      if (Date.now() - startedAt > RESOURCE_HEALTH_LIMITS.maximumDurationMs) {
        note('timeout');
        break;
      }
      let stat: Stats;
      try {
        stat = await fs.stat(sourcePath);
      } catch (error) {
        note(this.reasonFor(error));
        break;
      }
      if (stat.size > RESOURCE_HEALTH_LIMITS.maximumSourceFileBytes) {
        note('source-file-too-large');
        break;
      }
      if (sourceBytes + stat.size > RESOURCE_HEALTH_LIMITS.maximumSourceBytes) {
        note('source-byte-limit');
        break;
      }
      let content: string;
      try {
        content = await fs.readFile(sourcePath, 'utf8');
      } catch (error) {
        note(this.reasonFor(error));
        break;
      }
      sourceBytes += stat.size;
      scannedSourceFiles += 1;
      if (hasAmbiguousLocalReferenceSyntax(content)) {
        note('unparseable');
        break;
      }
      const references = extractLocalReferences(content);
      for (const reference of references) {
        const target = path.resolve(path.dirname(sourcePath), reference.source);
        if (!isWithin(normalizedInput.workspacePath, target)) continue;
        try {
          const targetStat = await fs.lstat(target);
          if (targetStat.isSymbolicLink()) continue;
          if (targetStat.isDirectory()) {
            protectedDirectories.push(target);
          } else if (targetStat.isFile() && isImagePath(target, normalizedInput.allowSvgImages)) {
            referencedPaths.add(target);
          }
        } catch (_error) {
          if (
            sourcePath !== normalizedInput.documentPath ||
            !isImagePath(target, normalizedInput.allowSvgImages)
          )
            continue;
          const key = target;
          const entry = missing.get(key) ?? { source: reference.source, locations: [] };
          entry.locations.push({
            line: reference.line,
            column: reference.column,
            raw: reference.raw,
            removable: reference.removable,
          });
          missing.set(key, entry);
        }
      }
    }

    const imageDirectory = path.resolve(
      path.dirname(normalizedInput.documentPath),
      normalizedInput.pasteImagesDir,
    );
    const candidates: StoredCandidate[] = [];
    let imageEntries = 0;
    const visitImages = async (directory: string): Promise<void> => {
      if (stop || !isWithin(normalizedInput.workspacePath, directory)) return;
      if (Date.now() - startedAt > RESOURCE_HEALTH_LIMITS.maximumDurationMs) {
        note('timeout');
        return;
      }
      let entries: Dirent[];
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') note(this.reasonFor(error));
        return;
      }
      for (const entry of entries) {
        if (stop) continue;
        if (entry.isSymbolicLink()) {
          note('symbolic-link');
          return;
        }
        if (entry.name.startsWith('.')) continue;
        imageEntries += 1;
        if (imageEntries > RESOURCE_HEALTH_LIMITS.maximumImageEntries) {
          note('image-entry-limit');
          return;
        }
        const entryPath = path.join(directory, entry.name);
        // Candidates are deliberately limited to direct image-directory entries. Nested paths
        // are outside this cleanup scope and cannot become destructive-action targets.
        if (entry.isDirectory()) continue;
        if (!entry.isFile() || !isImagePath(entryPath, normalizedInput.allowSvgImages)) continue;
        if (
          referencedPaths.has(entryPath) ||
          protectedDirectories.some((root) => isWithin(root, entryPath))
        )
          continue;
        let stat: Stats;
        try {
          stat = await fs.stat(entryPath);
        } catch (error) {
          note(this.reasonFor(error));
          return;
        }
        if (!(await hasSupportedImageSignature(entryPath, normalizedInput.allowSvgImages)))
          continue;
        candidates.push({
          id: randomUUID(),
          absolutePath: entryPath,
          relativePath: relativeDisplayPath(normalizedInput.workspacePath, entryPath),
          name: path.basename(entryPath),
          size: stat.size,
          modifiedAt: stat.mtimeMs,
          previewAvailable: stat.size <= RESOURCE_HEALTH_LIMITS.previewMaximumBytes,
        });
      }
    };
    await visitImages(imageDirectory);

    const documentStat = await fs.stat(normalizedInput.documentPath);
    const revision = randomUUID();
    const publicCandidates = candidates.map(
      ({ absolutePath: _absolutePath, ...candidate }) => candidate,
    );
    const summary: ResourceHealthScanSummary = {
      schemaVersion: 1,
      revision,
      documentRelativePath: relativeDisplayPath(
        normalizedInput.workspacePath,
        normalizedInput.documentPath,
      ),
      imageDirectoryRelativePath: relativeDisplayPath(
        normalizedInput.workspacePath,
        imageDirectory,
      ),
      workspaceName: path.basename(normalizedInput.workspacePath),
      savedAt: documentStat.mtimeMs,
      completedAt: Date.now(),
      scannedSourceFiles,
      candidates: publicCandidates,
      missingReferences: [...missing.entries()].map(([targetPath, entry]) => ({
        targetPath: relativeDisplayPath(normalizedInput.workspacePath, targetPath),
        source: entry.source,
        locations: entry.locations,
      })),
      candidateBytes: candidates.reduce((total, candidate) => total + candidate.size, 0),
      limitations: { complete: !stop, skipped },
    };
    if (scanEpoch === this.scanEpoch) {
      this.scans.clear();
      this.scans.set(revision, {
        input: normalizedInput,
        summary,
        candidates: new Map(candidates.map((item) => [item.id, item])),
      });
    }
    return summary;
  }

  resolveCandidate(revision: string, candidateId: string): string | null {
    return this.scans.get(revision)?.candidates.get(candidateId)?.absolutePath ?? null;
  }

  resolvePreviewCandidate(revision: string, candidateId: string): string | null {
    const candidate = this.scans.get(revision)?.candidates.get(candidateId);
    return candidate?.previewAvailable ? candidate.absolutePath : null;
  }

  async trashCandidates(
    revision: string,
    candidateIds: readonly string[],
    trash: (filePath: string) => Promise<void>,
  ): Promise<readonly ResourceHealthActionResult[]> {
    const uniqueCandidateIds = [...new Set(candidateIds)];
    const stored = this.scans.get(revision);
    if (!stored) return uniqueCandidateIds.map((id) => ({ id, code: 'not-found' }));
    if (!stored.summary.limitations.complete)
      return uniqueCandidateIds.map((id) => ({ id, code: 'scan-incomplete' }));
    const refreshed = await this.scan(stored.input);
    if (!refreshed.limitations.complete)
      return uniqueCandidateIds.map((id) => ({ id, code: 'scan-incomplete' }));
    return Promise.all(
      uniqueCandidateIds.map(async (id) => {
        const original = stored.candidates.get(id);
        if (!original) return { id, code: 'not-found' as const };
        if (!isWithin(stored.input.workspacePath, original.absolutePath))
          return { id, code: 'outside-workspace' as const };
        const current = refreshed.candidates.find(
          (candidate) => candidate.relativePath === original.relativePath,
        );
        if (!current) return { id, code: 'revalidated-as-referenced' as const };
        if (current.modifiedAt !== original.modifiedAt || current.size !== original.size)
          return { id, code: 'changed-since-scan' as const };
        if (!(await this.isSafeTrashPath(stored.input.workspacePath, original.absolutePath)))
          return { id, code: 'outside-workspace' as const };
        try {
          await trash(original.absolutePath);
          return { id, code: 'trashed' as const };
        } catch {
          return { id, code: 'failed' as const };
        }
      }),
    );
  }

  clear(): void {
    this.scanEpoch += 1;
    this.scans.clear();
  }

  private async normalizeInput(input: ResourceHealthScanInput): Promise<ResourceHealthScanInput> {
    const { workspacePath, documentPath } = await this.normalizeDocumentAndWorkspace(input);
    if (!input.pasteImagesDir || path.isAbsolute(input.pasteImagesDir))
      throw new Error('Image directory must be relative');
    const imageDirectory = path.resolve(path.dirname(documentPath), input.pasteImagesDir);
    if (!isWithin(workspacePath, imageDirectory))
      throw new Error('Image directory must belong to workspace');
    await this.assertImageDirectoryHasNoSymbolicLinks(workspacePath, imageDirectory);
    return { ...input, workspacePath, documentPath, pasteImagesDir: input.pasteImagesDir };
  }

  private async normalizeDocumentAndWorkspace(
    input: Pick<ResourceHealthScanInput, 'documentPath' | 'workspacePath'>,
  ): Promise<{ documentPath: string; workspacePath: string }> {
    const requestedDocumentPath = path.resolve(input.documentPath);
    const requestedDocumentStat = await fs.lstat(requestedDocumentPath);
    if (!requestedDocumentStat.isFile() || requestedDocumentStat.isSymbolicLink())
      throw new Error('Document must be a regular file');
    const workspacePath = await fs.realpath(path.resolve(input.workspacePath));
    const workspaceStat = await fs.stat(workspacePath);
    if (!workspaceStat.isDirectory()) throw new Error('Workspace must be a directory');
    const documentPath = await fs.realpath(requestedDocumentPath);
    if (!isWithin(workspacePath, documentPath))
      throw new Error('Document must belong to workspace');
    return { workspacePath, documentPath };
  }

  /** Reject a configured image directory that would traverse a symlink outside its scan scope. */
  private async assertImageDirectoryHasNoSymbolicLinks(
    workspacePath: string,
    imageDirectory: string,
  ): Promise<void> {
    const relativeDirectory = path.relative(workspacePath, imageDirectory);
    let segmentPath = workspacePath;
    for (const segment of relativeDirectory.split(path.sep)) {
      if (!segment) continue;
      segmentPath = path.join(segmentPath, segment);
      try {
        if ((await fs.lstat(segmentPath)).isSymbolicLink())
          throw new Error('Image directory must not include symbolic links');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
    }
  }

  private async isSafeTrashPath(workspacePath: string, candidatePath: string): Promise<boolean> {
    if (!isWithin(workspacePath, candidatePath)) return false;
    try {
      await this.assertImageDirectoryHasNoSymbolicLinks(workspacePath, path.dirname(candidatePath));
      const stat = await fs.lstat(candidatePath);
      if (!stat.isFile() || stat.isSymbolicLink()) return false;
      return isWithin(workspacePath, await fs.realpath(candidatePath));
    } catch {
      return false;
    }
  }

  private emptySkipped(): Record<ResourceHealthSkipReason, number> {
    return {
      'permission-denied': 0,
      'read-failed': 0,
      'source-file-limit': 0,
      'source-file-too-large': 0,
      'source-byte-limit': 0,
      'image-entry-limit': 0,
      'symbolic-link': 0,
      timeout: 0,
      unparseable: 0,
    };
  }

  private reasonFor(error: unknown): 'permission-denied' | 'read-failed' {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'EACCES' || code === 'EPERM' ? 'permission-denied' : 'read-failed';
  }
}
