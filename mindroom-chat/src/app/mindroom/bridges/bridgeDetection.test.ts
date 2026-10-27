import { describe, expect, it } from 'vitest';
import { isSignalBridgeRoom, isSignalBridgeUserId } from './bridgeDetection';

describe('bridgeDetection', () => {
  it('detects signal bridge bot user ids', () => {
    expect(isSignalBridgeUserId('@signalbot:example.org')).toBe(true);
    expect(isSignalBridgeUserId('@signalbot_prod:example.org')).toBe(true);
    expect(isSignalBridgeUserId('@telegrambot:example.org')).toBe(false);
    expect(isSignalBridgeUserId('signalbot')).toBe(false);
  });

  it('detects signal-bridged rooms from active bot membership', () => {
    expect(
      isSignalBridgeRoom({
        getMembers: () => [
          { userId: '@alice:example.org', membership: 'join' },
          { userId: '@signalbot:example.org', membership: 'join' },
        ],
      })
    ).toBe(true);
  });

  it('ignores left signal bots and non-signal bots', () => {
    expect(
      isSignalBridgeRoom({
        getMembers: () => [
          { userId: '@signalbot:example.org', membership: 'leave' },
          { userId: '@discordbot:example.org', membership: 'join' },
        ],
      })
    ).toBe(false);
  });
});
