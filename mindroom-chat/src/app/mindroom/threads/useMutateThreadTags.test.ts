import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { EventTimeline } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { getPendingThreadTagsContent, resetPendingThreadTagsForTests } from './threadTagPending';
import { buildPerTagStateKey, MINDROOM_THREAD_TAGS_EVENT } from './threadTags';
import { getValidThreadRootEvent } from './threadUtils';
import { useMutateThreadTags } from './useMutateThreadTags';

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: vi.fn(),
}));

const { threadUtilsMockState } = vi.hoisted(() => ({
  threadUtilsMockState: {
    defaultGetValidThreadRootEvent: undefined as
      | typeof import('./threadUtils').getValidThreadRootEvent
      | undefined,
  },
}));

vi.mock('./threadUtils', async () => {
  const actual = await vi.importActual<typeof import('./threadUtils')>('./threadUtils');
  threadUtilsMockState.defaultGetValidThreadRootEvent = actual.getValidThreadRootEvent;
  return {
    ...actual,
    getValidThreadRootEvent: vi.fn(actual.getValidThreadRootEvent),
  };
});

const mockedUseMatrixClient = vi.mocked(useMatrixClient);
const mockedGetValidThreadRootEvent = vi.mocked(getValidThreadRootEvent);
const ISO_1 = '2026-04-07T00:00:01.000Z';
const ISO_2 = '2026-04-07T00:00:02.000Z';

type HarnessProps = {
  room: Room;
  onRender: (value: ReturnType<typeof useMutateThreadTags>) => void;
};

function Harness({ room, onRender }: HarnessProps) {
  onRender(useMutateThreadTags(room));
  return null;
}

const makeThreadRootEvent = (eventId: string) => {
  const event = new MatrixEvent({
    content: { body: 'Root', msgtype: 'm.text' },
    event_id: eventId,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.message',
  });
  Object.defineProperty(event, 'isThreadRoot', {
    value: true,
    configurable: true,
  });
  return event;
};

const makeStandaloneMessageEvent = (eventId: string) =>
  new MatrixEvent({
    content: { body: 'Standalone message', msgtype: 'm.text' },
    event_id: eventId,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.message',
  });

const makeLegacyThreadTagsEvent = (
  stateKey: string,
  tags: Record<string, Record<string, unknown>>
) =>
  new MatrixEvent({
    content: { tags },
    event_id: `$legacy-thread-tags-${stateKey}`,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    state_key: stateKey,
    type: MINDROOM_THREAD_TAGS_EVENT,
  });

const makePerTagEvent = (threadRootId: string, tagName: string, content: Record<string, unknown>) =>
  new MatrixEvent({
    content,
    event_id: `$per-tag-${threadRootId}-${tagName}`,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    state_key: buildPerTagStateKey(threadRootId, tagName),
    type: MINDROOM_THREAD_TAGS_EVENT,
  });

const makeRoom = (events: MatrixEvent[] = [], eventsById: Record<string, MatrixEvent> = {}) =>
  ({
    roomId: '!room:example.org',
    getThread: (threadId: string) =>
      threadId === '$root' ? ({ rootEvent: makeThreadRootEvent('$root') } as never) : undefined,
    findEventById: (eventId: string) => eventsById[eventId],
    getLiveTimeline: () => ({
      getState: () => ({
        getStateEvents: (eventType: string, stateKey?: string) =>
          eventType === MINDROOM_THREAD_TAGS_EVENT
            ? events
            : stateKey === undefined
            ? []
            : undefined,
      }),
    }),
  } as unknown as Room);

describe('useMutateThreadTags', () => {
  const sendStateEvent = vi.fn();

  beforeEach(() => {
    sendStateEvent.mockReset();
    sendStateEvent.mockResolvedValue(undefined);
    mockedGetValidThreadRootEvent.mockReset();
    mockedGetValidThreadRootEvent.mockImplementation(
      threadUtilsMockState.defaultGetValidThreadRootEvent!
    );
    mockedUseMatrixClient.mockReturnValue({
      getSafeUserId: () => '@alice:example.org',
      sendStateEvent,
    } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    resetPendingThreadTagsForTests();
  });

  it.each(['setResolved', 'addTag', 'setUnresolved', 'removeTag'] as const)(
    'blocks pinned resolution through %s',
    async (operation) => {
      const room = makeRoom();
      const readState = room.getLiveTimeline().getState;
      room.getLiveTimeline = () =>
        ({
          getState: () => ({
            ...readState(EventTimeline.FORWARDS),
            getStateEvents: (type: string, stateKey?: string) =>
              type === 'm.room.pinned_events'
                ? new MatrixEvent({ type, state_key: '', content: { pinned: ['$root'] } })
                : stateKey === undefined
                ? readState(EventTimeline.FORWARDS)?.getStateEvents(type)
                : readState(EventTimeline.FORWARDS)?.getStateEvents(type, stateKey),
          }),
        } as never);
      let snapshot!: ReturnType<typeof useMutateThreadTags>;
      const renderer = create(
        React.createElement(Harness, {
          room,
          onRender: (value) => {
            snapshot = value;
          },
        })
      );
      await act(async () => {
        if (operation === 'setResolved') await snapshot.setResolved('$root', true);
        else if (operation === 'setUnresolved') await snapshot.setResolved('$root', false);
        else if (operation === 'removeTag') await snapshot.removeTag('$root', 'resolved');
        else await snapshot.addTag('$root', 'resolved');
      });
      expect(sendStateEvent).not.toHaveBeenCalled();
      expect(getPendingThreadTagsContent(room.roomId, '$root')).toBeUndefined();
      expect(snapshot.error).toBeInstanceOf(Error);
      renderer.unmount();
    }
  );

  it('allows another thread to resolve while suppressing duplicate writes to a pending thread', async () => {
    let finishFirst!: () => void;
    let rejectSecond!: (error: Error) => void;
    sendStateEvent
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishFirst = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, reject) => {
            rejectSecond = reject;
          })
      );
    const room = makeRoom([], { $second: makeThreadRootEvent('$second') });
    let snapshot!: ReturnType<typeof useMutateThreadTags>;
    const renderer = create(
      React.createElement(Harness, {
        room,
        onRender: (value) => {
          snapshot = value;
        },
      })
    );
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = snapshot.setResolved('$root', true);
      void snapshot.setResolved('$root', true);
      second = snapshot.setResolved('$second', true);
    });

    expect(sendStateEvent).toHaveBeenCalledTimes(2);
    expect(sendStateEvent.mock.calls.map((call) => call[3])).toEqual([
      '["$root","resolved"]',
      '["$second","resolved"]',
    ]);
    expect(snapshot.updatingThreadRootIds).toEqual(new Set(['$root', '$second']));

    await act(async () => {
      finishFirst();
      await first;
    });
    expect(snapshot.updating).toBe(true);
    expect(snapshot.updatingThreadRootIds).toEqual(new Set(['$second']));

    await act(async () => {
      rejectSecond(new Error('Save failed'));
      await second;
    });
    expect(snapshot.updating).toBe(false);
    expect(snapshot.updatingThreadRootIds.size).toBe(0);
    expect(getPendingThreadTagsContent(room.roomId, '$second')).toBeUndefined();
    expect(getPendingThreadTagsContent(room.roomId, '$root')?.tags.resolved).toBeDefined();

    await act(async () => {
      await snapshot.setResolved('$second', true);
    });
    expect(sendStateEvent).toHaveBeenCalledTimes(3);
    expect(snapshot.error).toBeNull();
    renderer.unmount();
  });

  it('writes new tags to canonical per-tag state keys and seeds aggregated pending state', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ISO_1));
    const room = makeRoom();

    let snapshot: ReturnType<typeof useMutateThreadTags> | undefined;
    const renderer = create(
      React.createElement(Harness, {
        room,
        onRender: (value) => {
          snapshot = value;
        },
      })
    );

    await act(async () => {
      await snapshot?.addTag('$root', 'bug');
    });

    expect(sendStateEvent).toHaveBeenCalledTimes(1);
    expect(sendStateEvent).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_THREAD_TAGS_EVENT,
      {
        set_by: '@alice:example.org',
        set_at: ISO_1,
      },
      '["$root","bug"]'
    );
    expect(getPendingThreadTagsContent('!room:example.org', '$root')).toEqual({
      tags: {
        bug: {
          set_by: '@alice:example.org',
          set_at: ISO_1,
        },
      },
    });

    renderer.unmount();
  });

  it('uses the validated thread root id for per-tag state keys and pending state', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ISO_1));
    const room = makeRoom();
    mockedGetValidThreadRootEvent.mockReturnValue(makeThreadRootEvent('$validated-root'));

    let snapshot: ReturnType<typeof useMutateThreadTags> | undefined;
    const renderer = create(
      React.createElement(Harness, {
        room,
        onRender: (value) => {
          snapshot = value;
        },
      })
    );

    await act(async () => {
      await snapshot?.addTag('$unvalidated-root', 'bug');
    });

    expect(sendStateEvent).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_THREAD_TAGS_EVENT,
      {
        set_by: '@alice:example.org',
        set_at: ISO_1,
      },
      '["$validated-root","bug"]'
    );
    expect(getPendingThreadTagsContent('!room:example.org', '$validated-root')).toEqual({
      tags: {
        bug: {
          set_by: '@alice:example.org',
          set_at: ISO_1,
        },
      },
    });
    expect(getPendingThreadTagsContent('!room:example.org', '$unvalidated-root')).toBeUndefined();

    renderer.unmount();
  });

  it('removes a tag by sending a per-tag tombstone and preserving other merged tags in pending state', async () => {
    const room = makeRoom([
      makeLegacyThreadTagsEvent('$root', {
        bug: { set_by: '@alice:example.org', set_at: ISO_1 },
      }),
      makePerTagEvent('$root', 'feature', {
        set_by: '@alice:example.org',
        set_at: ISO_2,
      }),
    ]);

    let snapshot: ReturnType<typeof useMutateThreadTags> | undefined;
    const renderer = create(
      React.createElement(Harness, {
        room,
        onRender: (value) => {
          snapshot = value;
        },
      })
    );

    await act(async () => {
      await snapshot?.removeTag('$root', 'feature');
    });

    expect(sendStateEvent).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_THREAD_TAGS_EVENT,
      {},
      '["$root","feature"]'
    );
    expect(getPendingThreadTagsContent('!room:example.org', '$root')).toEqual({
      tags: {
        bug: { set_by: '@alice:example.org', set_at: ISO_1 },
      },
    });

    renderer.unmount();
  });

  it('writes resolved as a normal canonical per-tag record', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ISO_2));
    const room = makeRoom([
      makeLegacyThreadTagsEvent('$root', {
        bug: { set_by: '@alice:example.org', set_at: ISO_1 },
      }),
    ]);

    let snapshot: ReturnType<typeof useMutateThreadTags> | undefined;
    const renderer = create(
      React.createElement(Harness, {
        room,
        onRender: (value) => {
          snapshot = value;
        },
      })
    );

    await act(async () => {
      await snapshot?.setResolved('$root', true);
    });

    expect(sendStateEvent).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_THREAD_TAGS_EVENT,
      {
        set_by: '@alice:example.org',
        set_at: ISO_2,
      },
      '["$root","resolved"]'
    );
    expect(getPendingThreadTagsContent('!room:example.org', '$root')).toEqual({
      tags: {
        bug: { set_by: '@alice:example.org', set_at: ISO_1 },
        resolved: { set_by: '@alice:example.org', set_at: ISO_2 },
      },
    });

    renderer.unmount();
  });

  it('resolves a standalone zero-reply root without requiring an SDK thread model', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ISO_2));
    const room = makeRoom([], {
      $standalone: makeStandaloneMessageEvent('$standalone'),
    });

    let snapshot: ReturnType<typeof useMutateThreadTags> | undefined;
    const renderer = create(
      React.createElement(Harness, {
        room,
        onRender: (value) => {
          snapshot = value;
        },
      })
    );

    await act(async () => {
      await snapshot?.setResolved('$standalone', true);
    });

    expect(sendStateEvent).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_THREAD_TAGS_EVENT,
      {
        set_by: '@alice:example.org',
        set_at: ISO_2,
      },
      '["$standalone","resolved"]'
    );
    expect(getPendingThreadTagsContent('!room:example.org', '$standalone')).toEqual({
      tags: {
        resolved: { set_by: '@alice:example.org', set_at: ISO_2 },
      },
    });

    renderer.unmount();
  });

  it('adds tags to confirmed standalone roots shown in the compact view', async () => {
    const room = makeRoom([], {
      $standalone: makeStandaloneMessageEvent('$standalone'),
    });

    let snapshot: ReturnType<typeof useMutateThreadTags> | undefined;
    const renderer = create(
      React.createElement(Harness, {
        room,
        onRender: (value) => {
          snapshot = value;
        },
      })
    );

    await act(async () => {
      await snapshot?.addTag('$standalone', 'triage');
    });

    expect(sendStateEvent).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_THREAD_TAGS_EVENT,
      expect.objectContaining({ set_by: '@alice:example.org' }),
      '["$standalone","triage"]'
    );
    expect(snapshot?.error).toBeNull();

    renderer.unmount();
  });

  it('unresolves by writing a per-tag tombstone', async () => {
    const room = makeRoom([
      makeLegacyThreadTagsEvent('$root', {
        bug: { set_by: '@alice:example.org', set_at: ISO_1 },
      }),
      makePerTagEvent('$root', 'resolved', {
        set_by: '@alice:example.org',
        set_at: ISO_2,
      }),
    ]);

    let snapshot: ReturnType<typeof useMutateThreadTags> | undefined;
    const renderer = create(
      React.createElement(Harness, {
        room,
        onRender: (value) => {
          snapshot = value;
        },
      })
    );

    await act(async () => {
      await snapshot?.setResolved('$root', false);
    });

    expect(sendStateEvent).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_THREAD_TAGS_EVENT,
      {},
      '["$root","resolved"]'
    );
    expect(getPendingThreadTagsContent('!room:example.org', '$root')).toEqual({
      tags: {
        bug: { set_by: '@alice:example.org', set_at: ISO_1 },
      },
    });

    renderer.unmount();
  });
});
