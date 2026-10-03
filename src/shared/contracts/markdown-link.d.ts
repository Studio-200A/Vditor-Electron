export type MarkdownLinkResolution =
  | { kind: 'resolved'; filePath: string; fragment: string }
  | { kind: 'error'; code: 'invalid-source' | 'invalid-link' | 'unsupported-target' | 'not-found' };
