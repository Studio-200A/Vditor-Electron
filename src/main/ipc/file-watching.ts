import { IPC_CHANNELS } from '../ipc-contract';
import {
  parseAbsolutePath,
  parseOptionalAbsolutePath,
  parseOptionalBoolean,
  parseOptionalInteger,
  parseOptionalText,
  parseResourceRootPaths,
  requireArgumentCount,
} from '../ipc-validation';
import type { LocalResourcePolicy } from '../local-resource';
import { WORKSPACE_READ_DEPTH_MAX, WORKSPACE_READ_DEPTH_MIN } from '../services/app-state';
import type { FileWatchService } from '../services/file-watch-service';
import type { TrustedChannelRegistration } from './trusted-channel';

export interface FileWatchingIpcDeps {
  fileWatchService: FileWatchService;
  localResourcePolicy: LocalResourcePolicy;
  registration: TrustedChannelRegistration;
}

export function registerFileWatchingIpcHandlers(deps: FileWatchingIpcDeps): void {
  const { handleTrusted } = deps.registration;
  const { fileWatchService, localResourcePolicy } = deps;

  handleTrusted(IPC_CHANNELS.fileSetWorkspaceWatch, (_event, ...args) => {
    requireArgumentCount(args, 0, 2);
    return fileWatchService.setWorkspace(
      parseOptionalAbsolutePath(args[0]),
      parseOptionalInteger(args, WORKSPACE_READ_DEPTH_MIN, WORKSPACE_READ_DEPTH_MAX),
    );
  });
  handleTrusted(IPC_CHANNELS.fileWatchDocument, (_event, ...args) => {
    requireArgumentCount(args, 1, 2);
    return fileWatchService.watchDocument(
      parseAbsolutePath(args[0]),
      parseOptionalBoolean(args[1], false),
    );
  });
  handleTrusted(IPC_CHANNELS.fileUnwatchDocument, (_event, ...args) => {
    requireArgumentCount(args, 1, 2);
    return fileWatchService.unwatchDocument(parseAbsolutePath(args[0]), parseOptionalText(args[1]));
  });
  handleTrusted(IPC_CHANNELS.fileResolveRenamedDocument, (_event, ...args) => {
    requireArgumentCount(args, 1);
    return fileWatchService.resolveRenamedDocument(parseAbsolutePath(args[0]));
  });
  // Controlled local-resource roots live with this module because they gate
  // which watched/served files the renderer may resolve, not because the
  // watcher service consumes them.
  handleTrusted(IPC_CHANNELS.fileSetResourceRoots, (_event, ...args) => {
    requireArgumentCount(args, 1);
    return localResourcePolicy.setRoots(parseResourceRootPaths(args[0]));
  });
}
