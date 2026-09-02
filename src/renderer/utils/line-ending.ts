export type LineEnding = 'CRLF' | 'LF';

export function detectLineEnding(content: string): LineEnding {
  return /\r\n/.test(content) ? 'CRLF' : 'LF';
}
