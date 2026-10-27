import { describe, expect, it } from 'vitest';
import { type TFunction } from 'i18next';
import { translateFromEn } from '../../test-utils/i18n';
import {
  commandPaletteStaticActionPaths,
  getCommandPaletteMessageTargets,
  getCommandPaletteQuickActions,
  resolveCommandPaletteUserTarget,
} from './commandPaletteActions';

const t = translateFromEn as unknown as TFunction;

describe('getCommandPaletteQuickActions', () => {
  it('shows only the global action set when no room or thread is selected', () => {
    expect(getCommandPaletteQuickActions({}, t).map((item) => item.id)).toEqual([
      'open-settings',
      'go-home',
      'go-direct',
      'go-inbox',
      'create-room',
      'create-space',
      'toggle-theme',
      'logout',
    ]);
  });

  it('adds room-scoped actions when a room is selected', () => {
    expect(
      getCommandPaletteQuickActions(
        {
          currentRoomName: 'General',
        },
        t
      ).map((item) => item.id)
    ).toContain('mark-current-room-read');
    expect(
      getCommandPaletteQuickActions(
        {
          currentRoomName: 'General',
        },
        t
      ).map((item) => item.id)
    ).toContain('open-current-room-settings');
  });

  it('switches between resolve and unresolve for the active thread', () => {
    expect(
      getCommandPaletteQuickActions(
        {
          currentThreadId: '$thread',
          isCurrentThreadResolved: false,
        },
        t
      ).map((item) => item.id)
    ).toContain('resolve-current-thread');
    expect(
      getCommandPaletteQuickActions(
        {
          currentThreadId: '$thread',
          isCurrentThreadResolved: false,
        },
        t
      ).map((item) => item.id)
    ).not.toContain('unresolve-current-thread');

    expect(
      getCommandPaletteQuickActions(
        {
          currentThreadId: '$thread',
          isCurrentThreadResolved: true,
        },
        t
      ).map((item) => item.id)
    ).toContain('unresolve-current-thread');
  });

  it('omits both resolution commands for pinned threads', () => {
    const ids = getCommandPaletteQuickActions(
      {
        currentThreadId: '$pinned',
        isCurrentThreadPinned: true,
      },
      t
    ).map((item) => item.id);
    expect(ids).not.toContain('resolve-current-thread');
    expect(ids).not.toContain('unresolve-current-thread');
  });
});

describe('getCommandPaletteMessageTargets', () => {
  it('builds current-room, current-space, and global search rows', () => {
    expect(
      getCommandPaletteMessageTargets(
        {
          query: 'deploy checklist',
          currentRoomId: '!room:example.org',
          currentRoomName: 'General',
          currentSpaceId: '!space:example.org',
          currentSpaceName: 'MindRoom',
        },
        t
      ).map((item) => item.path)
    ).toEqual([
      '/!space%3Aexample.org/search?term=deploy+checklist&rooms=%21room%3Aexample.org',
      '/!space%3Aexample.org/search?term=deploy+checklist',
      '/home/search/?term=deploy+checklist&global=true',
    ]);
  });

  it('omits message rows for an empty query', () => {
    expect(
      getCommandPaletteMessageTargets(
        {
          query: '   ',
          currentRoomId: '!room:example.org',
        },
        t
      )
    ).toEqual([]);
  });
});

describe('resolveCommandPaletteUserTarget', () => {
  it('reuses an existing DM room when one is known', () => {
    expect(resolveCommandPaletteUserTarget('@alice:example.org', '!dm:example.org')).toEqual({
      kind: 'room',
      roomId: '!dm:example.org',
    });
  });

  it('falls back to direct-create when no DM exists yet', () => {
    expect(resolveCommandPaletteUserTarget('@alice:example.org')).toEqual({
      kind: 'path',
      path: '/direct/create/?userId=%40alice%3Aexample.org',
    });
  });
});

describe('commandPaletteStaticActionPaths', () => {
  it('exposes the existing route helpers for the static navigation actions', () => {
    expect(commandPaletteStaticActionPaths).toEqual({
      goHome: '/home/',
      goDirect: '/direct/',
      goInbox: '/inbox/',
    });
  });
});
