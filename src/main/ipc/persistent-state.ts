import { IPC_CHANNELS } from '../ipc-contract';
import { parsePersistentStatePatch, requireArgumentCount } from '../ipc-validation';
import type { PersistentStateStore } from '../services/persistent-state-store';
import type { TrustedChannelRegistration } from './trusted-channel';

export interface PersistentStateIpcDeps {
  persistentStateStore: PersistentStateStore;
  registration: TrustedChannelRegistration;
}

export function registerPersistentStateIpcHandlers(deps: PersistentStateIpcDeps): void {
  const { handleTrusted } = deps.registration;
  const { persistentStateStore } = deps;

  handleTrusted(IPC_CHANNELS.appGetPersistentState, (_event, ...args) => {
    requireArgumentCount(args, 0);
    return persistentStateStore.getAll();
  });
  handleTrusted(IPC_CHANNELS.appSavePersistentState, async (_event, ...args) => {
    requireArgumentCount(args, 1);
    return persistentStateStore.updateOrThrow(parsePersistentStatePatch(args[0]));
  });
  handleTrusted(IPC_CHANNELS.appClearPersistentState, async (_event, ...args) => {
    requireArgumentCount(args, 0);
    return persistentStateStore.clearOrThrow();
  });
}
