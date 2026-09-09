export interface ExportHtmlDocument {
  readonly title: string;
  readonly baseDir: string;
  readonly content: string;
  readonly vditor: { getHTML(): string } | null;
  readonly host: HTMLElement;
}

export interface ExportHtmlAdapter {
  withOriginalImageSources<T>(host: HTMLElement, callback: () => T): T;
  relativeSourceFromLocalUrl(source: string, targetBaseUrl: string): string;
}

export interface ExportHtmlOptions {
  readonly adapter: ExportHtmlAdapter;
  readonly createLocalResourceBase: (baseDir: string) => string;
  readonly escapeHTML: (value: string) => string;
  readonly stripExtension: (value: string) => string;
  readonly fetch: typeof fetch;
}

/** Creates portable HTML/PDF bodies without giving the export transaction Vditor access. */
export class ExportHtmlBuilder {
  constructor(private readonly options: ExportHtmlOptions) {}

  snapshotBody(document: ExportHtmlDocument): string {
    return document.vditor
      ? this.options.adapter.withOriginalImageSources(document.host, () =>
          document.vditor!.getHTML(),
        )
      : `<pre>${this.options.escapeHTML(document.content)}</pre>`;
  }

  normalizeBody(
    body: string,
    document: ExportHtmlDocument,
    outputDirectory = document.baseDir,
  ): string {
    const template = window.document.createElement('template');
    template.innerHTML = body;
    const sourceBaseUrl = this.options.createLocalResourceBase(document.baseDir);
    const targetBaseUrl = this.options.createLocalResourceBase(outputDirectory);
    template.content.querySelectorAll('[src], [href], [poster], [srcset]').forEach((element) => {
      for (const attribute of ['src', 'href', 'poster']) {
        if (!element.hasAttribute(attribute)) continue;
        const source = element.getAttribute(attribute) || '';
        const portableSource = this.portableSource(source, sourceBaseUrl, targetBaseUrl);
        if (portableSource === null) element.removeAttribute(attribute);
        else if (portableSource !== source) element.setAttribute(attribute, portableSource);
      }
      if (!element.hasAttribute('srcset')) return;
      const portableSourceSet = this.portableSourceSet(
        element.getAttribute('srcset') || '',
        sourceBaseUrl,
        targetBaseUrl,
      );
      if (portableSourceSet) element.setAttribute('srcset', portableSourceSet);
      else element.removeAttribute('srcset');
    });
    return template.innerHTML;
  }

  async embedImages(body: string, document: ExportHtmlDocument): Promise<string> {
    const baseUrl = this.options.createLocalResourceBase(document.baseDir);
    if (!baseUrl) return body;
    const template = window.document.createElement('template');
    template.innerHTML = body;
    await Promise.all(
      Array.from(template.content.querySelectorAll('img[src]')).map(async (image) => {
        const source = image.getAttribute('src') || '';
        if (!source || source.startsWith('#')) return;
        let resolved: URL;
        try {
          resolved = new URL(source, baseUrl);
        } catch {
          return;
        }
        if (resolved.protocol !== 'local-file:') return;
        try {
          const response = await this.options.fetch(resolved.href);
          if (!response.ok) return;
          const blob = await response.blob();
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const contentType = blob.type.startsWith('image/') ? blob.type : imageMimeType(source);
          image.setAttribute('src', `data:${contentType};base64,${bytesToBase64(bytes)}`);
        } catch {
          // Keep the relative source when a local image cannot be read for PDF export.
        }
      }),
    );
    return template.innerHTML;
  }

  makeHTML(document: ExportHtmlDocument, body: string, outputDirectory = document.baseDir): string {
    const portableBody = this.normalizeBody(body, document, outputDirectory);
    return `<!doctype html><html><head><meta charset="utf-8"><title>${this.options.escapeHTML(this.options.stripExtension(document.title))}</title><style>body{max-width:860px;margin:40px auto;padding:0 24px;font:16px/1.7 system-ui;color:#24292f}pre,code{font-family:ui-monospace,monospace}pre{padding:16px;overflow:auto;background:#f6f8fa}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #d0d7de;padding:6px 12px}</style></head><body>${portableBody}</body></html>`;
  }

  private portableSource(
    source: string,
    sourceBaseUrl: string,
    targetBaseUrl: string,
  ): string | null {
    if (!source || source.startsWith('#')) return source;
    let resolved: URL;
    try {
      resolved = new URL(source, sourceBaseUrl || 'https://vditor-export.invalid/');
    } catch {
      return source;
    }
    if (resolved.protocol === 'app:') return null;
    if (resolved.protocol !== 'local-file:') return source;
    return targetBaseUrl
      ? this.options.adapter.relativeSourceFromLocalUrl(resolved.href, targetBaseUrl) || null
      : null;
  }

  private portableSourceSet(
    sourceSet: string,
    sourceBaseUrl: string,
    targetBaseUrl: string,
  ): string {
    return sourceSet
      .split(',')
      .map((candidate) => {
        const [source, ...descriptor] = candidate.trim().split(/\s+/);
        if (!source) return '';
        const portableSource = this.portableSource(source, sourceBaseUrl, targetBaseUrl);
        return portableSource === null ? '' : [portableSource, ...descriptor].join(' ');
      })
      .filter(Boolean)
      .join(', ');
  }
}

function imageMimeType(source: string): string {
  const extension = source.split(/[?#]/, 1)[0].toLowerCase().split('.').pop();
  return (
    {
      apng: 'image/apng',
      avif: 'image/avif',
      gif: 'image/gif',
      jpeg: 'image/jpeg',
      jpg: 'image/jpeg',
      png: 'image/png',
      svg: 'image/svg+xml',
      webp: 'image/webp',
    }[extension || ''] || 'application/octet-stream'
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}
