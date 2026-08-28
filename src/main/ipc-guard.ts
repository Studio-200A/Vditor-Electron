import { isTrustedAppPageUrl } from './app-url';

export type IpcRequestErrorCode = 'IPC_UNTRUSTED_RENDERER' | 'IPC_INVALID_ARGUMENT';

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
