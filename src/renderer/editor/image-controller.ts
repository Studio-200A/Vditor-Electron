export interface ImageUploadTab {
  readonly filePath: string | null;
  readonly vditor: { insertMD(markdown: string): void } | null;
}

export interface ImageRuntimeTab {
  readonly host: HTMLElement;
  readonly baseDir: string;
  resourceObserver: { disconnect(): void } | null;
}

export interface ImageFileBridge {
  dirname(filePath: string): Promise<string>;
  writeBinaryFile(filePath: string, bytes: Uint8Array): Promise<void>;
  relative(from: string, to: string): Promise<string>;
}

export interface ImageControllerOptions {
  readonly fileBridge: ImageFileBridge;
  readonly getAssetsDirectory: () => string;
  readonly getMaximumWidth: () => number;
  readonly getQuality: () => number;
  readonly onError: (message: string) => void;
  readonly formatError: (error: unknown) => string;
  readonly saveFirstMessage: () => string;
  readonly uploadFailedMessage: (error: string) => string;
  readonly getTimestamp?: () => number;
}

export class ImageController {
  private readonly fileBridge: ImageFileBridge;
  private readonly getAssetsDirectory: ImageControllerOptions['getAssetsDirectory'];
  private readonly getMaximumWidth: ImageControllerOptions['getMaximumWidth'];
  private readonly getQuality: ImageControllerOptions['getQuality'];
  private readonly onError: ImageControllerOptions['onError'];
  private readonly formatError: ImageControllerOptions['formatError'];
  private readonly saveFirstMessage: ImageControllerOptions['saveFirstMessage'];
  private readonly uploadFailedMessage: ImageControllerOptions['uploadFailedMessage'];
  private readonly getTimestamp: () => number;

  constructor(options: ImageControllerOptions) {
    this.fileBridge = options.fileBridge;
    this.getAssetsDirectory = options.getAssetsDirectory;
    this.getMaximumWidth = options.getMaximumWidth;
    this.getQuality = options.getQuality;
    this.onError = options.onError;
    this.formatError = options.formatError;
    this.saveFirstMessage = options.saveFirstMessage;
    this.uploadFailedMessage = options.uploadFailedMessage;
    this.getTimestamp = options.getTimestamp ?? Date.now;
  }

  async upload(tab: ImageUploadTab, files: File[]): Promise<string | null> {
    const filePath = tab.filePath;
    const vditor = tab.vditor;
    if (!filePath) {
      this.onError(this.saveFirstMessage());
      return 'Document must be saved first';
    }
    try {
      const documentDirectory = await this.fileBridge.dirname(filePath);
      const assetsDirectory = this.getAssetsDirectory().replace(/^\.\//, '');
      const destinationDirectory = `${documentDirectory}/${assetsDirectory}`;
      const markdown: string[] = [];
      for (const file of files) {
        const fileName = `${this.getTimestamp()}-${sanitizeImageFileName(file.name)}`;
        const destination = `${destinationDirectory}/${fileName}`;
        await this.fileBridge.writeBinaryFile(destination, await this.compress(file));
        const relativePath = await this.fileBridge.relative(documentDirectory, destination);
        markdown.push(`![${file.name}](${encodeURI(relativePath)})`);
      }
      // Upload I/O can outlive an editor rebuild or Save As. Never insert into
      // a replacement editor after writing assets for the original document.
      if (tab.filePath !== filePath || tab.vditor !== vditor) return null;
      vditor?.insertMD(markdown.join('\n'));
      return null;
    } catch (error) {
      const message = this.formatError(error);
      this.onError(this.uploadFailedMessage(message));
      return message;
    }
  }

  private async compress(file: File): Promise<Uint8Array> {
    const original = new Uint8Array(await file.arrayBuffer());
    const maximumWidth = this.getMaximumWidth();
    if (!file.type.match(/^image\/(png|jpeg|webp)$/) || !maximumWidth) return original;
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width <= maximumWidth) {
        bitmap.close();
        return original;
      }
      const canvas = document.createElement('canvas');
      canvas.width = maximumWidth;
      canvas.height = Math.round((bitmap.height * maximumWidth) / bitmap.width);
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, file.type, this.getQuality()),
      );
      return blob ? new Uint8Array(await blob.arrayBuffer()) : original;
    } catch {
      return original;
    }
  }
}

export function sanitizeImageFileName(fileName: string): string {
  return fileName.replace(/[^\w.\-\u4e00-\u9fff]/g, '_');
}

export interface ImageRuntimeControllerOptions {
  readonly localResourceBase: (baseDir: string) => string;
  readonly adapter: {
    observeRelativeImageSources(host: HTMLElement, baseUrl: string): { disconnect(): void } | null;
    reloadImageSources(host: HTMLElement): void;
  };
}

/** Owns the adapter-backed relative-resource observer for each editor runtime. */
export class ImageRuntimeController<TTab extends ImageRuntimeTab> {
  private readonly localResourceBase: ImageRuntimeControllerOptions['localResourceBase'];
  private readonly adapter: ImageRuntimeControllerOptions['adapter'];

  constructor(options: ImageRuntimeControllerOptions) {
    this.localResourceBase = options.localResourceBase;
    this.adapter = options.adapter;
  }

  attach(tab: TTab): void {
    const baseUrl = this.localResourceBase(tab.baseDir);
    tab.host.dataset.localResourceBase = baseUrl;
    this.detach(tab);
    tab.resourceObserver = this.adapter.observeRelativeImageSources(tab.host, baseUrl);
  }

  detach(tab: TTab): void {
    tab.resourceObserver?.disconnect();
    tab.resourceObserver = null;
  }

  reload(tabs: readonly TTab[]): void {
    tabs.forEach((tab) => this.adapter.reloadImageSources(tab.host));
  }
}
