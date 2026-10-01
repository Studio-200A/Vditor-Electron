import { shell } from 'electron';
import * as path from 'path';
import { invalidIpcArgument } from '../ipc-guard';
import { IPC_CHANNELS } from '../ipc-contract';
import {
  parseAbsolutePath,
  parseBinary,
  parseEnum,
  parseFileName,
  parseOptionalAbsolutePath,
  parseOptionalBoolean,
  parseOptionalText,
  parseText,
  requireArgumentCount,
} from '../ipc-validation';
import { resolveRelativeMarkdownLink } from '../resolve-markdown-link';
import type { FileManagerService } from '../services/file-manager';
import type { FileWatchService } from '../services/file-watch-service';
import type { TrustedChannelRegistration } from './trusted-channel';

export interface FileOperationsIpcDeps {
  fileManager: FileManagerService;
  fileWatchService: FileWatchService;
  registration: TrustedChannelRegistration;
}

export function registerFileOperationsIpcHandlers(deps: FileOperationsIpcDeps): void {
  const { handleTrusted } = deps.registration;
  const { fileManager, fileWatchService } = deps;

  handleTrusted(IPC_CHANNELS.fileRead, (_event, ...args) => {
    requireArgumentCount(args, 1);
    return fileManager.readFile(parseAbsolutePath(args[0]));
  });
  handleTrusted(IPC_CHANNELS.fileWrite, (_event, ...args) => {
    requireArgumentCount(args, 2);
    return fileManager.writeFile(parseAbsolutePath(args[0]), parseText(args[1]));
  });
  handleTrusted(IPC_CHANNELS.fileWriteDocument, async (_event, ...args) => {
    requireArgumentCount(args, 2, 4);
    const filePath = parseAbsolutePath(args[0]);
    const content = parseText(args[1]);
    const expectedContent = parseOptionalText(args[2]);
    const expectedAbsent = parseOptionalBoolean(args[3], false);
    if (expectedContent !== undefined && expectedAbsent) invalidIpcArgument();
    const result = await fileManager.writeDocument(
      filePath,
      content,
      expectedContent,
      expectedAbsent,
    );
    if (!('error' in result)) fileWatchService.markOwnDocumentWrite(filePath);
    return result;
  });
  handleTrusted(IPC_CHANNELS.fileWriteBinary, (_event, ...args) => {
    requireArgumentCount(args, 2);
    return fileManager.writeBinaryFile(parseAbsolutePath(args[0]), parseBinary(args[1]));
  });
  handleTrusted(IPC_CHANNELS.fileExists, (_event, ...args) => {
    requireArgumentCount(args, 1);
    return fileManager.exists(parseAbsolutePath(args[0]));
  });
  handleTrusted(IPC_CHANNELS.fileIdentity, (_event, ...args) => {
    requireArgumentCount(args, 1);
    return fileManager.fileIdentity(parseAbsolutePath(args[0]));
  });
  handleTrusted(IPC_CHANNELS.fileListDir, (_event, ...args) => {
    requireArgumentCount(args, 1, 2);
    return fileManager.listDir(parseAbsolutePath(args[0]), parseOptionalAbsolutePath(args[1]));
  });
  handleTrusted(IPC_CHANNELS.fileCreate, (_event, ...args) => {
    requireArgumentCount(args, 3);
    return fileManager.createItem(
      parseAbsolutePath(args[0]),
      parseFileName(args[1]),
      parseEnum(args[2], ['file', 'directory']),
    );
  });
  handleTrusted(IPC_CHANNELS.fileRename, async (_event, ...args) => {
    requireArgumentCount(args, 2);
    const oldPath = parseAbsolutePath(args[0]);
    const newName = parseFileName(args[1]);
    const destination = await fileManager.prepareRename(oldPath, newName);
    fileWatchService.markOwnWorkspaceRename(oldPath, destination);
    try {
      return await fileManager.renameItem(oldPath, newName);
    } catch (error) {
      fileWatchService.clearOwnWorkspaceRename(oldPath, destination);
      throw error;
    }
  });
  handleTrusted(IPC_CHANNELS.filePrepareRename, (_event, ...args) => {
    requireArgumentCount(args, 2);
    return fileManager.prepareRename(parseAbsolutePath(args[0]), parseFileName(args[1]));
  });
  handleTrusted(IPC_CHANNELS.fileDelete, (_event, ...args) => {
    requireArgumentCount(args, 1);
    return shell.trashItem(parseAbsolutePath(args[0]));
  });
  handleTrusted(IPC_CHANNELS.fileBasename, (_event, ...args) => {
    requireArgumentCount(args, 1);
    return path.basename(parseAbsolutePath(args[0]));
  });
  handleTrusted(IPC_CHANNELS.fileDirname, (_event, ...args) => {
    requireArgumentCount(args, 1);
    return path.dirname(parseAbsolutePath(args[0]));
  });
  handleTrusted(IPC_CHANNELS.fileRelative, (_event, ...args) => {
    requireArgumentCount(args, 2);
    return path
      .relative(parseAbsolutePath(args[0]), parseAbsolutePath(args[1]))
      .split(path.sep)
      .join('/');
  });
  handleTrusted(IPC_CHANNELS.fileRebasePath, (_event, ...args) => {
    requireArgumentCount(args, 3);
    return fileManager.rebasePath(
      parseAbsolutePath(args[0]),
      parseAbsolutePath(args[1]),
      parseAbsolutePath(args[2]),
    );
  });
  handleTrusted(IPC_CHANNELS.fileResolveMarkdownLink, (_event, ...args) => {
    requireArgumentCount(args, 2);
    return resolveRelativeMarkdownLink(parseAbsolutePath(args[0]), parseText(args[1]));
  });
}
