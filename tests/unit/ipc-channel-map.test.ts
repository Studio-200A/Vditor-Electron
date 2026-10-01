import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS } from '../../src/main/ipc-contract';
import { FROZEN_CHANNEL_REGISTRATIONS, FROZEN_EVENT_CHANNELS } from './ipc-channel-map.fixture';

/**
 * Validates the stage-0 frozen channel map against the current IPC contract so
 * the frozen expectation data itself cannot drift (typos, omissions, renames).
 * This is NOT the stage-5 registration coverage test; it never imports any
 * registration code.
 */
describe('frozen IPC channel map', () => {
  it('matches every IPC_CHANNELS value exactly once', () => {
    const frozenChannels = [
      ...FROZEN_CHANNEL_REGISTRATIONS.map((entry) => entry.channel),
      ...FROZEN_EVENT_CHANNELS,
    ];
    const contractChannels = Object.values(IPC_CHANNELS);

    expect(new Set(frozenChannels).size).toBe(frozenChannels.length);
    expect(new Set(frozenChannels)).toEqual(new Set(contractChannels));
  });

  it('freezes 56 invoke and 8 send registrations plus 7 event channels', () => {
    const invoke = FROZEN_CHANNEL_REGISTRATIONS.filter((entry) => entry.direction === 'invoke');
    const send = FROZEN_CHANNEL_REGISTRATIONS.filter((entry) => entry.direction === 'send');

    expect(invoke).toHaveLength(56);
    expect(send).toHaveLength(8);
    expect(FROZEN_EVENT_CHANNELS).toHaveLength(7);
  });

  it('keeps event channels out of the registration map', () => {
    const registered = new Set(FROZEN_CHANNEL_REGISTRATIONS.map((entry) => entry.channel));
    for (const channel of FROZEN_EVENT_CHANNELS) expect(registered.has(channel)).toBe(false);
  });
});
