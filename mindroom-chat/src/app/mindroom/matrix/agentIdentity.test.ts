import { KnownMembership } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { hasActiveMindroomAgent } from './agentIdentity';

describe('hasActiveMindroomAgent', () => {
  it('recognizes joined and invited MindRoom agents', () => {
    expect(
      hasActiveMindroomAgent([
        { membership: KnownMembership.Join, userId: '@alice:example.org' },
        { membership: KnownMembership.Invite, userId: '@mindroom_helper:example.org' },
      ])
    ).toBe(true);

    expect(
      hasActiveMindroomAgent([
        { membership: KnownMembership.Join, userId: '@mindroom_helper:example.org' },
      ])
    ).toBe(true);
  });

  it('ignores departed agents and active human members', () => {
    expect(
      hasActiveMindroomAgent([
        { membership: KnownMembership.Leave, userId: '@mindroom_helper:example.org' },
        { membership: KnownMembership.Join, userId: '@alice:example.org' },
      ])
    ).toBe(false);
  });
});
