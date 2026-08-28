import { isTrustedAppPageUrl } from './app-url';

export type IpcRequestErrorCode =
  | 'IPC_UNTRUSTED_RENDERER'
  | 'IPC_INVALID_ARGUMENT'
  | 'IPC_PERMISSION_DENIED'
  | 'IPC_ALREADY_EXISTS'
  | 'IPC_NOT_FOUND'
  | 'IPC_INVALID_NAME'
  | 'IPC_SETTINGS_PERSIST_FAILED'
  | 'IPC_OPERATION_FAILED';

export class IpcRequestError extends Error {
  constructor(readonly code: IpcRequestErrorCode) {
    super(code);
    this.name = 'IpcRequestError';
  }
}

export interface IpcSenderFrame {
  parent: unknown | null;
  url: string;
}

export interface IpcSenderEvent {
  sender: unknown;
  senderFrame: IpcSenderFrame | null;
}

/** Only the canonical top-level application document may use privileged IPC. */
export function isTrustedMainFrame(event: IpcSenderEvent, mainWebContents: unknown): boolean {
  const frame = event.senderFrame;
  return (
    mainWebContents !== null &&
    mainWebContents !== undefined &&
    event.sender === mainWebContents &&
    frame !== null &&
    frame.parent === null &&
    isTrustedAppPageUrl(frame.url)
  );
}

export function requireTrustedMainFrame(event: IpcSenderEvent, mainWebContents: unknown): void {
  if (!isTrustedMainFrame(event, mainWebContents))
    throw new IpcRequestError('IPC_UNTRUSTED_RENDERER');
}

export function invalidIpcArgument(): never {
  throw new IpcRequestError('IPC_INVALID_ARGUMENT');
}

function errorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) return '';
  return typeof error.code === 'string' ? error.code : '';
}

/**
 * Convert main-process failures to renderer-safe errors without sending paths,
 * native messages, or stacks across the IPC boundary.
 */
export function normalizeIpcError(error: unknown): IpcRequestError | Error {
  if (error instanceof IpcRequestError) return error;

  // Keep the P08-compatible error text for unsupported external URL schemes.
  if (error instanceof Error && error.message === 'Unsupported URL protocol') return error;

  switch (errorCode(error)) {
    case 'EACCES':
    case 'EPERM':
      return new IpcRequestError('IPC_PERMISSION_DENIED');
    case 'EEXIST':
      return new IpcRequestError('IPC_ALREADY_EXISTS');
    case 'ENOENT':
    case 'ENOTDIR':
      return new IpcRequestError('IPC_NOT_FOUND');
    case 'EINVAL':
    case 'ENAMETOOLONG':
      return new IpcRequestError('IPC_INVALID_NAME');
    case 'SETTINGS_PERSIST_FAILED':
      return new IpcRequestError('IPC_SETTINGS_PERSIST_FAILED');
    default:
      return new IpcRequestError('IPC_OPERATION_FAILED');
  }
}
