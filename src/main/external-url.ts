import { parseValidatedUrl } from './validated-url';

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function allowedExternalUrl(value: unknown): string | null {
  const url = parseValidatedUrl(value);
  return url && ALLOWED_EXTERNAL_PROTOCOLS.has(url.protocol) ? url.href : null;
}
