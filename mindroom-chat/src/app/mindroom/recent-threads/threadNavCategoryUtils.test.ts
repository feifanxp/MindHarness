import { describe, expect, it } from 'vitest';
import type { CrossRoomThreadIndexEntry } from '../cross-room-threads/crossRoomThreadIndex';
import { buildSidebarThreadEntries } from './threadNavCategoryUtils';

const makeEntry = ({
  key,
  lastActivityTs,
  isInvolved = true,
  isResolved = false,
  roomId = key,
}: {
  key: string;
  lastActivityTs: number;
  isInvolved?: boolean;
  isResolved?: boolean;
  roomId?: string;
}): CrossRoomThreadIndexEntry =>
  ({
    key,
    roomId,
    lastActivityTs,
    isInvolved,
    isUnread: false,
    hasAttention: false,
    isResolved,
    roomName: key,
    threadRootId: key,
  } as CrossRoomThreadIndexEntry);

describe('buildSidebarThreadEntries', () => {
  it('keeps pins first in saved order and sorts the rest by last activity', () => {
    const oldestPinned = makeEntry({ key: 'pinned-old', lastActivityTs: 1 });
    const newestPinned = makeEntry({ key: 'pinned-new', lastActivityTs: 10 });
    const older = makeEntry({ key: 'older', lastActivityTs: 20 });
    const newer = makeEntry({ key: 'newer', lastActivityTs: 30 });

    expect(
      buildSidebarThreadEntries(
        [oldestPinned, newer, newestPinned, older],
        ['pinned-old', 'pinned-new']
      ).map((entry) => entry.key)
    ).toEqual(['pinned-old', 'pinned-new', 'newer', 'older']);
  });

  it('includes uninvolved room threads in activity order', () => {
    const newest = makeEntry({ key: 'newest', lastActivityTs: 30, isInvolved: false });
    const pinned = makeEntry({ key: 'pinned', lastActivityTs: 10, isInvolved: false });
    const involved = makeEntry({ key: 'involved', lastActivityTs: 20 });

    expect(
      buildSidebarThreadEntries([newest, involved, pinned], ['pinned']).map((entry) => entry.key)
    ).toEqual(['pinned', 'newest', 'involved']);
  });

  it('excludes resolved threads even when they are pinned', () => {
    const unresolved = makeEntry({ key: 'unresolved', lastActivityTs: 10 });
    const resolved = makeEntry({ key: 'resolved', lastActivityTs: 20, isResolved: true });

    expect(
      buildSidebarThreadEntries([unresolved, resolved], ['resolved']).map((entry) => entry.key)
    ).toEqual(['unresolved']);
  });

  it('excludes threads from direct-message rooms even when they are pinned', () => {
    const roomThread = makeEntry({ key: 'room', lastActivityTs: 10, roomId: '!room' });
    const directThread = makeEntry({ key: 'direct', lastActivityTs: 20, roomId: '!direct' });

    expect(
      buildSidebarThreadEntries([roomThread, directThread], ['direct'], new Set(['!direct'])).map(
        (entry) => entry.key
      )
    ).toEqual(['room']);
  });

  it('caps the compact sidebar list after sorting', () => {
    const entries = Array.from({ length: 5 }, (_, index) =>
      makeEntry({ key: `${index}`, lastActivityTs: index })
    );

    expect(buildSidebarThreadEntries(entries, [], new Set(), 2).map((entry) => entry.key)).toEqual([
      '4',
      '3',
    ]);
  });
});
