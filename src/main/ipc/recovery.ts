import { IPC_CHANNELS } from '../ipc-contract';
import { parseText, requireArgumentCount } from '../ipc-validation';
import type { RecoveryStore } from '../services/recovery-store';
import type { TrustedChannelRegistration } from './trusted-channel';

export interface RecoveryIpcDeps {
  recoveryStore: RecoveryStore;
  registration: TrustedChannelRegistration;
}

export function registerRecoveryIpcHandlers(deps: RecoveryIpcDeps): void {
  const { handleTrusted } = deps.registration;
  const { recoveryStore } = deps;

  handleTrusted(IPC_CHANNELS.appGetRecoveryCandidates, (_event, ...args) => {
    requireArgumentCount(args, 0);
    return recoveryStore.listCandidates();
  });
  handleTrusted(IPC_CHANNELS.appRestoreRecovery, (_event, ...args) => {
    requireArgumentCount(args, 1);
    return recoveryStore.restore(parseText(args[0], 128));
  });
  handleTrusted(IPC_CHANNELS.appSaveRecovery, (_event, ...args) => {
    requireArgumentCount(args, 1);
    return recoveryStore.save(args[0]);
  });
  handleTrusted(IPC_CHANNELS.appDiscardRecovery, (_event, ...args) => {
    requireArgumentCount(args, 1);
    return recoveryStore.discard(parseText(args[0], 128));
  });
}
