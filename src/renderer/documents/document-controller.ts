import {
  DocumentCloseController,
  type DocumentCloseCallbacks,
} from './document-close-controller.js';
import { DocumentSaveController } from './document-save-controller.js';
import {
  ExternalChangeController,
  type ExternalChangeDecision,
  type ExternalChangeDecisionInput,
} from './external-change-controller.js';

export interface OpenedDocument {
  readonly id: string;
  readonly filePath: string | null;
  readonly fileIdentity: string | null;
}

export interface DocumentFileBridge {
  fileIdentity(filePath: string): Promise<string | null>;
  readFile(filePath: string): Promise<{ content: string; encoding: string }>;
  dirname(filePath: string): Promise<string>;
}

export interface OpenDocumentInput {
  readonly filePath: string | null;
  readonly fileIdentity: string | null;
  readonly title?: string;
  readonly content: string;
  readonly encoding: string;
  readonly baseDir: string;
  readonly activate: boolean;
  readonly pendingAnchor: string;
}

export interface DocumentControllerOptions<TDocument extends OpenedDocument> {
  readonly fileBridge: DocumentFileBridge;
  readonly findDocumentByIdentity: (identity: string | null) => TDocument | null;
  /** Optional fallback for display-path collisions such as an untitled target. */
  readonly findDocumentByPath?: (filePath: string) => TDocument | null;
  readonly createDocument: (input: OpenDocumentInput) => TDocument | null;
  readonly prepareDocumentResources: (baseDir: string) => Promise<void>;
  readonly onExistingDocument: (
    document: TDocument,
    input: Pick<OpenDocumentInput, 'filePath' | 'fileIdentity' | 'activate' | 'pendingAnchor'>,
  ) => void;
  readonly onDocumentOpened: (document: TDocument) => Promise<void>;
  readonly onDocumentNotCreated: () => Promise<void>;
  readonly readDocumentContent: (document: TDocument) => string;
}

/** Owns document commands without reading or changing tab DOM. */
export class DocumentController<TDocument extends OpenedDocument> {
  private readonly fileBridge: DocumentFileBridge;
  private readonly findDocumentByIdentity: (identity: string | null) => TDocument | null;
  private readonly findDocumentByPath: (filePath: string) => TDocument | null;
  private readonly createDocument: (input: OpenDocumentInput) => TDocument | null;
  private readonly prepareDocumentResources: (baseDir: string) => Promise<void>;
  private readonly onExistingDocument: DocumentControllerOptions<TDocument>['onExistingDocument'];
  private readonly onDocumentOpened: (document: TDocument) => Promise<void>;
  private readonly onDocumentNotCreated: () => Promise<void>;
  private readonly readDocumentContent: (document: TDocument) => string;
  private readonly openingByKey = new Map<string, Promise<TDocument | null>>();
  private readonly saveController = new DocumentSaveController();
  private readonly closeController = new DocumentCloseController();
  private readonly externalChangeController = new ExternalChangeController();

  constructor(options: DocumentControllerOptions<TDocument>) {
    this.fileBridge = options.fileBridge;
    this.findDocumentByIdentity = options.findDocumentByIdentity;
    this.findDocumentByPath = options.findDocumentByPath ?? (() => null);
    this.createDocument = options.createDocument;
    this.prepareDocumentResources = options.prepareDocumentResources;
    this.onExistingDocument = options.onExistingDocument;
    this.onDocumentOpened = options.onDocumentOpened;
    this.onDocumentNotCreated = options.onDocumentNotCreated;
    this.readDocumentContent = options.readDocumentContent;
  }

  async openPath(filePath: string, activate = true, pendingAnchor = ''): Promise<TDocument | null> {
    const fileIdentity = await this.fileBridge.fileIdentity(filePath);
    const existing = this.findExistingDocument(filePath, fileIdentity);
    if (existing) {
      this.onExistingDocument(existing, { filePath, fileIdentity, activate, pendingAnchor });
      return existing;
    }

    const key = fileIdentity ?? filePath;
    const opening = this.openingByKey.get(key);
    if (opening) return opening;
    const operation = this.openNewDocument({ filePath, fileIdentity, activate, pendingAnchor });
    this.openingByKey.set(key, operation);
    try {
      return await operation;
    } finally {
      if (this.openingByKey.get(key) === operation) this.openingByKey.delete(key);
    }
  }

  createUntitled(title: string, activate = true): TDocument | null {
    return this.createDocument({
      filePath: null,
      fileIdentity: null,
      title,
      content: '',
      encoding: 'utf-8',
      baseDir: '',
      activate,
      pendingAnchor: '',
    });
  }

  currentContent(document: TDocument | null): string {
    return document ? this.readDocumentContent(document) : '';
  }

  /** Coordinates document-owned saves while keeping file/editor details injected by the shell. */
  save<TResult>(document: TDocument, operation: () => Promise<TResult>): Promise<TResult> {
    return this.saveController.run(document.id, operation);
  }

  /** Serializes writes that target the same physical file through an alias path. */
  saveForIdentity<TResult>(identity: string, operation: () => Promise<TResult>): Promise<TResult> {
    return this.saveController.runForIdentity(identity, operation);
  }

  close<TClosable extends { id: string }>(
    document: TClosable,
    callbacks: DocumentCloseCallbacks<TClosable>,
  ): Promise<boolean> {
    return this.closeController.close(document, callbacks);
  }

  classifyExternalChange(input: ExternalChangeDecisionInput): ExternalChangeDecision {
    return this.externalChangeController.classify(input);
  }

  private async openNewDocument(
    input: Pick<OpenDocumentInput, 'fileIdentity' | 'activate' | 'pendingAnchor'> & {
      readonly filePath: string;
    },
  ): Promise<TDocument | null> {
    const result = await this.fileBridge.readFile(input.filePath);
    const baseDir = await this.fileBridge.dirname(input.filePath);
    await this.prepareDocumentResources(baseDir);

    // A concurrent opener may have created the canonical document while I/O was pending.
    const existing = this.findExistingDocument(input.filePath, input.fileIdentity);
    if (existing) {
      this.onExistingDocument(existing, input);
      return existing;
    }
    const document = this.createDocument({ ...input, ...result, baseDir });
    if (!document) {
      await this.onDocumentNotCreated();
      return null;
    }
    await this.onDocumentOpened(document);
    return document;
  }

  private findExistingDocument(filePath: string, fileIdentity: string | null): TDocument | null {
    return this.findDocumentByIdentity(fileIdentity) ?? this.findDocumentByPath(filePath);
  }
}
