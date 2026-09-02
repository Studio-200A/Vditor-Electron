export type ResultCode = 'ok' | 'conflict' | 'unchanged' | 'unavailable' | 'cancelled';

export interface WriteResult {
  ok: boolean;
  code: ResultCode;
  message?: string;
}

export interface DocumentIdentity {
  identity: string;
  displayPath: string;
}

export interface FileListItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  isSymlink?: boolean;
}
