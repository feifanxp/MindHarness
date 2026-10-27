import React from 'react';
import { RoomEvent, ThreadEvent, type MatrixEvent, type Room, type Thread } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { useThreadRootEvent } from './useThreadRootEvent';

const makeEvent = (
  eventId: string,
  options?: {
    threadRootId?: string;
    txnId?: string;
    isSending?: boolean;
  }
) =>
  ({
    getId: () => eventId,
    getTxnId: () => options?.txnId,
    getUnsigned: () =>
      options?.txnId
        ? {
            transaction_id: options.txnId,
          }
        : {},
    isSending: () => options?.isSending ?? false,
    threadRootId: options?.threadRootId,
  } as unknown as MatrixEvent);

const makeRoom = ({
  events = [],
  txnEvents = new Map<string, ReturnType<typeof makeEvent>>(),
}: {
  events?: ReturnType<typeof makeEvent>[];
  txnEvents?: Map<string, ReturnType<typeof makeEvent>>;
} = {}) => {
  const listeners = new Map<string | symbol, (...args: unknown[]) => void>();

  return {
    roomId: '!room:example.org',
    findEventById: (eventId: string) => events.find((event) => event.getId() === eventId),
    getEventForTxnId: (txnId: string) => txnEvents.get(txnId),
    getLiveTimeline: () => ({
      getEvents: () => events,
    }),
    getThread: () => null,
    on: (event: string | symbol, handler: (...args: unknown[]) => void) => {
      listeners.set(event, handler);
    },
    removeListener: (event: string | symbol) => {
      listeners.delete(event);
    },
    __listeners: listeners,
  } as unknown as Room & { __listeners: typeof listeners };
};

describe('useThreadRootEvent', () => {
  it('uses a known SDK root without scanning other threads on mount or updates', async () => {
    const room = makeRoom();
    const root = makeEvent('$root');
    room.getThread = () => ({ id: '$root', rootEvent: root } as Thread);
    const lookup = vi.spyOn(room, 'findEventById');
    const observed: Array<string | undefined> = [];
    const HookProbe = () => {
      observed.push(useThreadRootEvent(room, '$root'));
      return null;
    };
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(HookProbe));
    });
    await act(async () => {
      room.__listeners.get(ThreadEvent.Update)?.();
      room.__listeners.get(RoomEvent.Timeline)?.(root, room, false, false);
    });
    expect(observed.at(-1)).toBe('$root');
    expect(lookup).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
  });

  it('refreshes readiness when an unknown route gains an SDK root with the same ID', async () => {
    const room = makeRoom();
    const observed: Array<string | undefined> = [];
    const HookProbe = () => {
      observed.push(useThreadRootEvent(room, '$root'));
      return null;
    };
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(HookProbe));
    });
    expect(observed).toEqual(['$root']);
    room.getThread = () => ({ id: '$root', rootEvent: makeEvent('$root') } as Thread);
    await act(async () => {
      room.__listeners.get(ThreadEvent.New)?.();
    });
    expect(observed).toEqual(['$root', '$root']);
    await act(async () => renderer.unmount());
  });

  it('updates a pending local-echo thread root id when LocalEchoUpdated confirms it', async () => {
    const pendingRoot = makeEvent('~pending-root', {
      txnId: 'txn-1',
      isSending: true,
    });
    const confirmedRoot = makeEvent('$confirmed-root', {
      txnId: 'txn-1',
    });
    const events = [pendingRoot];
    const room = makeRoom({
      events,
      txnEvents: new Map([['txn-1', confirmedRoot]]),
    });
    const observedRootIds: Array<string | undefined> = [];

    const HookProbe = ({ threadId }: { threadId?: string }) => {
      const rootId = useThreadRootEvent(room, threadId);
      observedRootIds.push(rootId);
      return null;
    };

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(React.createElement(HookProbe, { threadId: '~pending-root' }));
    });

    events.splice(0, events.length, confirmedRoot);

    await act(async () => {
      room.__listeners.get(RoomEvent.LocalEchoUpdated)?.(confirmedRoot, room, '~pending-root');
    });

    expect(observedRootIds.at(-1)).toBe('$confirmed-root');

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('resolves a stale local-echo route id on mount when the confirmed event is already live', async () => {
    const confirmedRoot = makeEvent('$confirmed-root', {
      txnId: 'm1775932488410.3',
    });
    const room = makeRoom({
      events: [confirmedRoot],
    });
    const observedRootIds: Array<string | undefined> = [];

    const HookProbe = ({ threadId }: { threadId?: string }) => {
      const rootId = useThreadRootEvent(room, threadId);
      observedRootIds.push(rootId);
      return null;
    };

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(HookProbe, {
          threadId: '~!room:example.org:m1775932488410.3',
        })
      );
    });

    expect(observedRootIds.at(-1)).toBe('$confirmed-root');

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('still resolves thread replies back to their thread root ids', async () => {
    const replyEvent = makeEvent('$reply', {
      threadRootId: '$root',
    });
    const room = makeRoom({
      events: [replyEvent],
    });
    const observedRootIds: Array<string | undefined> = [];

    const HookProbe = ({ threadId }: { threadId?: string }) => {
      const rootId = useThreadRootEvent(room, threadId);
      observedRootIds.push(rootId);
      return null;
    };

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(React.createElement(HookProbe, { threadId: '$reply' }));
    });

    expect(observedRootIds.at(-1)).toBe('$root');

    await act(async () => {
      room.__listeners.get(ThreadEvent.Update)?.();
      renderer?.unmount();
    });
  });

  it('does not emit the previous thread root for a new thread route while props are updating', async () => {
    const replyA = makeEvent('$reply-a', {
      threadRootId: '$root-a',
    });
    const replyB = makeEvent('$reply-b', {
      threadRootId: '$root-b',
    });
    const room = makeRoom({
      events: [replyA, replyB],
    });
    const observedRenders: Array<{ threadId: string | undefined; rootId: string | undefined }> = [];

    const HookProbe = ({ threadId }: { threadId?: string }) => {
      const rootId = useThreadRootEvent(room, threadId);
      observedRenders.push({ threadId, rootId });
      return null;
    };

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(React.createElement(HookProbe, { threadId: '$reply-a' }));
    });

    await act(async () => {
      renderer?.update(React.createElement(HookProbe, { threadId: '$reply-b' }));
    });

    expect(observedRenders).not.toContainEqual({
      threadId: '$reply-b',
      rootId: '$root-a',
    });
    expect(observedRenders.at(-1)).toEqual({
      threadId: '$reply-b',
      rootId: '$root-b',
    });

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('ignores unrelated LocalEchoUpdated events while a confirmed thread root is already open', async () => {
    const rootEvent = makeEvent('$root');
    const room = makeRoom({
      events: [rootEvent],
    });
    const observedRootIds: Array<string | undefined> = [];

    const HookProbe = ({ threadId }: { threadId?: string }) => {
      const rootId = useThreadRootEvent(room, threadId);
      observedRootIds.push(rootId);
      return null;
    };

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(React.createElement(HookProbe, { threadId: '$root' }));
    });

    await act(async () => {
      room.__listeners.get(RoomEvent.LocalEchoUpdated)?.(makeEvent('$reply'), room, undefined);
    });

    await act(async () => {
      room.__listeners.get(RoomEvent.LocalEchoUpdated)?.(
        makeEvent('$reply-2'),
        room,
        '~!room:example.org:m123'
      );
    });

    expect(observedRootIds.at(-1)).toBe('$root');

    await act(async () => {
      renderer?.unmount();
    });
  });
});
