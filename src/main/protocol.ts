import { protocol, net } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { isTrustedAppResourceUrl } from './app-url';

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const RENDERER_DIR = path.join(PROJECT_ROOT, 'dist', 'renderer');
const STATIC_DIR = path.join(PROJECT_ROOT, 'static');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
  {
    scheme: 'local-file',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

export function registerAppProtocol(): void {
  protocol.handle('app', (request) => {
    if (!isTrustedAppResourceUrl(request.url)) return new Response('Not found', { status: 404 });

    const url = new URL(request.url);
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return new Response('Not found', { status: 404 });
    }

    let filePath: string;

    if (pathname.startsWith('/vditor/')) {
      filePath = path.join(STATIC_DIR, pathname.slice('/vditor/'.length));
    } else {
      filePath = path.join(RENDERER_DIR, pathname === '/' ? 'index.html' : pathname.slice(1));
    }

    if (pathname.endsWith('/')) {
      filePath = path.join(filePath, 'index.html');
    }

    const allowedRoot = pathname.startsWith('/vditor/') ? STATIC_DIR : RENDERER_DIR;
    if (
      !path.resolve(filePath).startsWith(path.resolve(allowedRoot) + path.sep) ||
      !fs.existsSync(filePath)
    ) {
      console.warn(`[app://] 404: ${request.url} → ${filePath}`);
      return new Response('Not found: ' + pathname, { status: 404 });
    }

    try {
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (err) {
      console.error(`[app://] Error: ${filePath}`, err);
      return new Response('Read error', { status: 500 });
    }
  });

  protocol.handle('local-file', (request) => {
    const url = new URL(request.url);
    const filePath = path.resolve(decodeURIComponent(url.pathname));
    if (!path.isAbsolute(filePath) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return new Response('Local file not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}
