import { parseValidatedUrl } from './validated-url';

const APP_PROTOCOL = 'app:';
const APP_HOST = 'app';
const APP_PAGE_PATHS = new Set(['/', '/index.html']);

function parseTrustedAppUrl(value: unknown): URL | null {
  const url = parseValidatedUrl(value);
  if (
    !url ||
    url.protocol !== APP_PROTOCOL ||
    url.hostname.toLowerCase() !== APP_HOST ||
    url.port ||
    url.username ||
    url.password
  )
    return null;
  return url;
}

export function isTrustedAppResourceUrl(value: unknown): boolean {
  return parseTrustedAppUrl(value) !== null;
}

export function isTrustedAppPageUrl(value: unknown): boolean {
  const url = parseTrustedAppUrl(value);
  return url !== null && APP_PAGE_PATHS.has(url.pathname) && !url.search;
}
