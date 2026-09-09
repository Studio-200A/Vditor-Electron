import type { AppAPI, FileAPI } from '../types/bridges.js';

export interface ExportDocument {
  readonly title: string;
  readonly baseDir: string;
}

export interface ExportControllerOptions<TDocument extends ExportDocument> {
  readonly getActiveDocument: () => TDocument | null;
  readonly fileAPI: Pick<FileAPI, 'exportDialog' | 'dirname' | 'writeFile'>;
  readonly appAPI: Pick<AppAPI, 'exportPDF'>;
  readonly getDefaultDirectory: () => string | undefined;
  readonly snapshotBody: (document: TDocument) => string;
  readonly normalizeBody: (body: string, document: TDocument, outputDirectory?: string) => string;
  readonly embedImages: (body: string, document: TDocument) => Promise<string>;
  readonly makeHTML: (document: TDocument, body: string, outputDirectory?: string) => string;
  readonly defaultFileName: (document: TDocument, type: 'html' | 'pdf') => string;
  readonly rememberConfirmedDirectory: (outputPath: string) => Promise<void>;
  readonly showExported: (outputPath: string) => void;
}

/**
 * Owns export transaction ordering. Content is snapshotted before a native dialog opens, while
 * source normalization and PDF image embedding remain injected, independently testable policies.
 */
export class ExportController<TDocument extends ExportDocument> {
  private readonly options: ExportControllerOptions<TDocument>;

  constructor(options: ExportControllerOptions<TDocument>) {
    this.options = options;
  }

  async exportHTML(): Promise<void> {
    const document = this.options.getActiveDocument();
    if (!document) return;
    const body = this.options.snapshotBody(document);
    const output = await this.options.fileAPI.exportDialog(
      'html',
      this.options.defaultFileName(document, 'html'),
      this.options.getDefaultDirectory(),
    );
    if (!output) return;
    await this.options.rememberConfirmedDirectory(output);
    const outputDirectory = await this.options.fileAPI.dirname(output);
    await this.options.fileAPI.writeFile(
      output,
      this.options.makeHTML(document, body, outputDirectory),
    );
    this.options.showExported(output);
  }

  async exportPDF(): Promise<void> {
    const document = this.options.getActiveDocument();
    if (!document) return;
    const snapshot = this.options.snapshotBody(document);
    const normalized = this.options.normalizeBody(snapshot, document);
    const body = await this.options.embedImages(normalized, document);
    const output = await this.options.appAPI.exportPDF(
      this.options.makeHTML(document, body),
      this.options.defaultFileName(document, 'pdf'),
      this.options.getDefaultDirectory(),
    );
    if (!output) return;
    await this.options.rememberConfirmedDirectory(output);
    this.options.showExported(output);
  }
}
