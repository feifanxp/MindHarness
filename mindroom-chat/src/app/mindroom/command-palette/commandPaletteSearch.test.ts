import { describe, expect, it } from 'vitest';
import type {
  CommandPaletteActionItem,
  CommandPaletteRoomItem,
  CommandPaletteThreadItem,
  CommandPaletteUserItem,
} from './commandPaletteTypes';
import { commandPaletteSearchConfig, searchCommandPaletteSection } from './commandPaletteSearch';

describe('commandPaletteSearchConfig', () => {
  it('uses the agreed fuse keys, thresholds, and caps per section', () => {
    expect(commandPaletteSearchConfig.actions).toEqual({
      keys: ['title', 'keywords', 'description'],
      threshold: 0.25,
      limit: 6,
    });
    expect(commandPaletteSearchConfig.rooms).toEqual({
      keys: ['name', 'canonicalAlias', 'topic', 'parentNames'],
      threshold: 0.3,
      limit: 8,
    });
    expect(commandPaletteSearchConfig.users).toEqual({
      keys: ['displayName', 'userId', 'localpart', 'dmRoomName'],
      threshold: 0.35,
      limit: 6,
    });
    expect(commandPaletteSearchConfig.threads).toEqual({
      keys: ['summaryText', 'roomName', 'participantNames', 'tags'],
      threshold: 0.4,
      limit: 8,
    });
  });
});

describe('searchCommandPaletteSection', () => {
  it('bypasses fuse for empty queries and keeps the provided starter ordering', () => {
    const items: CommandPaletteActionItem[] = [
      {
        id: 'logout',
        kind: 'action',
        title: 'Logout',
        sortRank: 10,
      },
      {
        id: 'settings',
        kind: 'action',
        title: 'Open Settings',
        sortRank: 20,
      },
    ];

    const results = searchCommandPaletteSection({
      items,
      query: '   ',
      config: commandPaletteSearchConfig.actions,
    });

    expect(results.map((item) => item.id)).toEqual(['settings', 'logout']);
  });

  it('matches room metadata fields from the section config', () => {
    const items: CommandPaletteRoomItem[] = [
      {
        id: '!eng:example.org',
        kind: 'room',
        name: 'Engineering',
        parentNames: ['Platform'],
      },
      {
        id: '!sales:example.org',
        kind: 'room',
        name: 'Sales',
      },
    ];

    const results = searchCommandPaletteSection({
      items,
      query: 'platform',
      config: commandPaletteSearchConfig.rooms,
    });

    expect(results.map((item) => item.id)).toEqual(['!eng:example.org']);
  });

  it('applies a small boost pass after fuse scoring', () => {
    const items: CommandPaletteUserItem[] = [
      {
        id: '@older:example.org',
        kind: 'user',
        displayName: 'Alice',
        userId: '@older:example.org',
        localpart: 'alice-old',
        boost: 10,
      },
      {
        id: '@recent:example.org',
        kind: 'user',
        displayName: 'Alice',
        userId: '@recent:example.org',
        localpart: 'alice-recent',
        boost: 100,
      },
    ];

    const results = searchCommandPaletteSection({
      items,
      query: 'alice',
      config: commandPaletteSearchConfig.users,
    });

    expect(results.map((item) => item.id)).toEqual([
      '@recent:example.org',
      '@older:example.org',
    ]);
  });

  it('searches array fields such as thread tags', () => {
    const items: CommandPaletteThreadItem[] = [
      {
        id: '$thread-1',
        kind: 'thread',
        summaryText: 'Investigate login issue',
        roomName: 'Support',
        tags: ['urgent'],
      },
      {
        id: '$thread-2',
        kind: 'thread',
        summaryText: 'Review docs',
        roomName: 'Docs',
        tags: ['docs'],
      },
    ];

    const results = searchCommandPaletteSection({
      items,
      query: 'urgent',
      config: commandPaletteSearchConfig.threads,
    });

    expect(results.map((item) => item.id)).toEqual(['$thread-1']);
  });
});
