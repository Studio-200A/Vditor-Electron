import { isTrustedAppPageUrl } from './app-url';
import { allowedExternalUrl } from './external-url';

export type NavigationDecision =
  { kind: 'internal' } | { kind: 'external'; url: string } | { kind: 'blocked' };

export function classifyNavigation(value: unknown): NavigationDecision {
  if (isTrustedAppPageUrl(value)) return { kind: 'internal' };
  const externalUrl = allowedExternalUrl(value);
  return externalUrl ? { kind: 'external', url: externalUrl } : { kind: 'blocked' };
}
