import { shell } from 'electron';
import * as path from 'path';
import { invalidIpcArgument } from '../ipc-guard';
import { IPC_CHANNELS } from '../ipc-contract';
import {
  parseAbsolutePath,
  parseBoolean,
  parseResourceHealthCandidateIds,
  parseText,
  requireArgumentCount,
} from '../ipc-validation';
import { formatLocalResourceBase } from '../local-resource';
import type { ResourceHealthService } from '../services/resource-health-service';
import type { SettingsStore } from '../services/settings-store';
import type { TrustedChannelRegistration } from './trusted-channel';

export interface ResourceHealthIpcDeps {
  resourceHealthService: ResourceHealthService;
  settingsStore: SettingsStore;
  /** Records menu eligibility and rebuilds the menu when it changes. */
  onMenuEligibilityChanged: (eligible: boolean) => void;
  registration: TrustedChannelRegistration;
}

export function registerResourceHealthIpcHandlers(deps: ResourceHealthIpcDeps): void {
  const { handleTrusted, onTrusted } = deps.registration;
  const { resourceHealthService, settingsStore, onMenuEligibilityChanged } = deps;

  handleTrusted(IPC_CHANNELS.appResourceHealthEligible, async (_event, ...args) => {
    requireArgumentCount(args, 2);
    return resourceHealthService.isEligible({
      documentPath: parseAbsolutePath(args[0]),
      workspacePath: parseAbsolutePath(args[1]),
    });
  });
  handleTrusted(IPC_CHANNELS.appSetResourceHealthEligible, (_event, ...args) => {
    requireArgumentCount(args, 1);
    onMenuEligibilityChanged(parseBoolean(args[0]));
  });
  handleTrusted(IPC_CHANNELS.appResourceHealthScan, (_event, ...args) => {
    requireArgumentCount(args, 2);
    return resourceHealthService.scan({
      documentPath: parseAbsolutePath(args[0]),
      workspacePath: parseAbsolutePath(args[1]),
      pasteImagesDir: settingsStore.get('pasteImagesDir'),
      allowSvgImages: settingsStore.get('allowSvgImages'),
    });
  });
  handleTrusted(IPC_CHANNELS.appResourceHealthReveal, (_event, ...args) => {
    requireArgumentCount(args, 2);
    const candidatePath = resourceHealthService.resolveCandidate(
      parseText(args[0], 128),
      parseText(args[1], 128),
    );
    if (!candidatePath) invalidIpcArgument();
    shell.showItemInFolder(candidatePath);
  });
  handleTrusted(IPC_CHANNELS.appResourceHealthPreview, (_event, ...args) => {
    requireArgumentCount(args, 2);
    const candidatePath = resourceHealthService.resolvePreviewCandidate(
      parseText(args[0], 128),
      parseText(args[1], 128),
    );
    if (!candidatePath) return null;
    return `${formatLocalResourceBase(path.dirname(candidatePath))}${encodeURIComponent(path.basename(candidatePath))}`;
  });
  handleTrusted(IPC_CHANNELS.appResourceHealthTrash, (_event, ...args) => {
    requireArgumentCount(args, 2);
    return resourceHealthService.trashCandidates(
      parseText(args[0], 128),
      parseResourceHealthCandidateIds(args[1]),
      (candidatePath) => shell.trashItem(candidatePath),
    );
  });
  onTrusted(IPC_CHANNELS.appResourceHealthDiscard, (_event, ...args) => {
    requireArgumentCount(args, 0);
    resourceHealthService.clear();
  });
}
