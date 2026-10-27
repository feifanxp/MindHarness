import React, { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MatrixEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThreadEditBackfillController } from '../threadEditBackfillController';

let approvalScope: { roomId: string; threadId: string } | undefined;
vi.mock('../../messages/ThreadApprovalProvider', () => ({
  useThreadApprovals: () => approvalScope,
}));

// Task #129 regression suite. Reproduces the mid-thread "Thinking…"
// placeholder band: the controller used to mark every candidate
// attempted BEFORE its async /relations fetch, then the effect (dep:
// threadEvents, which the cache work churns constantly) cancelled the
// in-flight batch on any change — stranding marked-but-unresolved
// events the gate then refused to retry. Fixed by marking attempted
// only on a definitive fetch outcome and never on cancel/error, plus an
// in-flight guard so churn re-runs don't refetch.
//
// All fixtures are synthetic (no production data in the repo).

const ROOM = '!room:example.org';
const SENDER = '@agent:example.org';

const makePlaceholder = (eventId: string) =>
  new MatrixEvent({
    content: { body: 'Thinking...', msgtype: 'm.text' },
    event_id: eventId,
    origin_server_ts: 1000,
    room_id: ROOM,
    sender: SENDER,
    type: 'm.room.message',
  });

const makeEditFor = (targetId: string, editId: string, ts: number, body: string) =>
  new MatrixEvent({
    content: {
      body: `* ${body}`,
      'm.new_content': { body, msgtype: 'm.text' },
      'm.relates_to': { event_id: targetId, rel_type: 'm.replace' },
      msgtype: 'm.text',
    },
    event_id: editId,
    origin_server_ts: ts,
    room_id: ROOM,
    sender: SENDER,
    type: 'm.room.message',
  });

type Deferred = { promise: Promise<{ events: MatrixEvent[] }>; resolve: () => void };

const makeHarness = () => {
  // One deferred per target so tests control fetch completion timing.
  const deferreds = new Map<string, Deferred>();
  // Targets whose NEXT fetch should reject once (transient error).
  const failOnce = new Set<string>();
  const relations = vi.fn((_room: string, targetId: string) => {
    if (failOnce.has(targetId)) {
      failOnce.delete(targetId);
      return Promise.reject(new Error('transient'));
    }
    let resolveFn!: () => void;
    const editResult = { events: [makeEditFor(targetId, `$edit-${targetId}`, 2000, 'resolved')] };
    const promise = new Promise<{ events: MatrixEvent[] }>((res) => {
      resolveFn = () => res(editResult);
    });
    deferreds.set(targetId, { promise, resolve: resolveFn });
    return promise;
  });
  const mx = {
    relations,
    getThread: () => undefined,
  } as never;
  const room = {
    roomId: ROOM,
    getThread: () => undefined,
    findEventById: () => undefined,
  } as never;
  return { deferreds, failOnce, relations, mx, room };
};

const makeProps = (harness: ReturnType<typeof makeHarness>, threadEvents: MatrixEvent[]) => {
  return {
    props: {
      atLiveEndRef: { current: false },
      eventId: undefined,
      forceTimelineUpdate: vi.fn(),
      mx: harness.mx,
      beginThreadCacheWrite: vi.fn().mockReturnValue(vi.fn()),
      room: harness.room,
      scrollRef: { current: null },
      scrollToBottomRef: { current: { count: 0, smooth: false } },
      notifyThreadEventsChanged: vi.fn(),
      editResetEpoch: 0,
      readEditResetEpoch: () => 0,
      threadEvents,
      threadId: '$thread-root',
      threadIdRef: { current: '$thread-root' },
      threadTailLoaded: true,
    },
  };
};

const Harness = (props: Parameters<typeof useThreadEditBackfillController>[0]) => {
  useThreadEditBackfillController(props);
  return null;
};

const flush = async () => {
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
};

describe('useThreadEditBackfillController (task #129)', () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.restoreAllMocks());

  it('keeps the repair request limit across streaming renders and drains every placeholder', async () => {
    const harness = makeHarness();
    const targets = Array.from({ length: 24 }, (_, index) => makePlaceholder(`$burst-${index}`));
    const { props } = makeProps(harness, targets);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(Harness, props));
    });
    try {
      expect(harness.relations).toHaveBeenCalledTimes(4);
      for (let render = 0; render < 5; render += 1) {
        // Streaming and cache hydration both replace the event-array identity.
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
          renderer.update(React.createElement(Harness, { ...props, threadEvents: [...targets] }));
        });
      }
      expect(harness.relations).toHaveBeenCalledTimes(4);

      for (let start = 0; start < targets.length; start += 4) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
          targets.slice(start, start + 4).forEach((event) => {
            harness.deferreds.get(event.getId()!)!.resolve();
          });
          await flush();
        });
      }
      expect(targets.every((event) => event.getContent().body === 'resolved')).toBe(true);
      expect(harness.relations).toHaveBeenCalledTimes(targets.length);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it('uses available repair slots for new candidates while an older request is stalled', async () => {
    const harness = makeHarness();
    const initial = Array.from({ length: 4 }, (_, index) => makePlaceholder(`$initial-${index}`));
    const arrival = makePlaceholder('$arrival');
    const { props } = makeProps(harness, initial);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(Harness, props));
    });
    try {
      expect(harness.relations).toHaveBeenCalledTimes(4);
      await act(async () => {
        initial.slice(1).forEach((event) => harness.deferreds.get(event.getId()!)!.resolve());
        await flush();
      });
      await act(async () => {
        renderer.update(
          React.createElement(Harness, { ...props, threadEvents: [...initial, arrival] })
        );
        await flush();
      });
      expect(harness.relations).toHaveBeenCalledTimes(5);
      await act(async () => {
        harness.deferreds.get('$arrival')!.resolve();
        await flush();
      });
      expect(arrival.getContent().body).toBe('resolved');
      expect(initial[0].getContent().body).toBe('Thinking...');
    } finally {
      act(() => renderer.unmount());
      await act(async () => {
        harness.deferreds.forEach(({ resolve }) => resolve());
        await flush();
      });
    }
  });

  it.each([false, true])(
    'uses a released slot for a queued arrival without retrying its failure (fails: %s)',
    async (fails) => {
      const harness = makeHarness();
      const initial = Array.from({ length: 4 }, (_, index) => makePlaceholder(`$held-${index}`));
      const arrival = makePlaceholder('$queued-arrival');
      if (fails) harness.failOnce.add('$queued-arrival');
      const { props } = makeProps(harness, initial);
      let renderer!: ReactTestRenderer;
      await act(async () => {
        renderer = create(React.createElement(Harness, props));
      });
      try {
        await act(async () => {
          renderer.update(
            React.createElement(Harness, { ...props, threadEvents: [...initial, arrival] })
          );
        });
        expect(harness.relations).toHaveBeenCalledTimes(4);
        await act(async () => {
          harness.deferreds.get(initial[1].getId()!)!.resolve();
          await flush();
        });
        expect(harness.relations).toHaveBeenCalledTimes(5);
        await act(async () => {
          harness.deferreds.get('$queued-arrival')?.resolve();
          await flush();
        });
        expect(arrival.getContent().body).toBe(fails ? 'Thinking...' : 'resolved');
        expect(initial[0].getContent().body).toBe('Thinking...');
        expect(harness.relations).toHaveBeenCalledTimes(5);
      } finally {
        act(() => renderer.unmount());
        await act(async () => {
          harness.deferreds.forEach(({ resolve }) => resolve());
          await flush();
        });
      }
    }
  );

  it('wakes the current thread when a stale request releases controller capacity', async () => {
    const harness = makeHarness();
    const previous = Array.from({ length: 4 }, (_, index) => makePlaceholder(`$previous-${index}`));
    const current = makePlaceholder('$current');
    const { props } = makeProps(harness, previous);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(Harness, props));
    });
    try {
      props.threadIdRef.current = '$current-thread';
      await act(async () => {
        renderer.update(
          React.createElement(Harness, {
            ...props,
            threadEvents: [current],
            threadId: '$current-thread',
          })
        );
      });
      expect(harness.relations).toHaveBeenCalledTimes(4);
      await act(async () => {
        harness.deferreds.get(previous[0].getId()!)!.resolve();
        await flush();
      });
      expect(harness.relations).toHaveBeenCalledTimes(5);
      expect(previous[0].getContent().body).toBe('Thinking...');
      expect(props.beginThreadCacheWrite()).not.toHaveBeenCalled();
      await act(async () => {
        harness.deferreds.get('$current')!.resolve();
        await flush();
      });
      expect(current.getContent().body).toBe('resolved');
      expect(props.beginThreadCacheWrite()).toHaveBeenCalledWith(
        '$current-thread',
        [current],
        undefined,
        undefined,
        true
      );
    } finally {
      act(() => renderer.unmount());
      await act(async () => {
        harness.deferreds.forEach(({ resolve }) => resolve());
        await flush();
      });
    }
  });

  it('repairs newly arrived candidates after a busy batch returns no edits', async () => {
    const harness = makeHarness();
    let release!: () => void;
    const pending = new Promise<{ events: MatrixEvent[] }>((resolve) => {
      release = () => resolve({ events: [] });
    });
    for (let index = 0; index < 4; index += 1) harness.relations.mockReturnValueOnce(pending);
    const initial = Array.from({ length: 4 }, (_, index) => makePlaceholder(`$empty-${index}`));
    const arrival = makePlaceholder('$arrival');
    const { props } = makeProps(harness, initial);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(Harness, props));
    });
    try {
      await act(async () => {
        renderer.update(
          React.createElement(Harness, { ...props, threadEvents: [...initial, arrival] })
        );
      });
      expect(harness.relations).toHaveBeenCalledTimes(4);
      await act(async () => {
        release();
        await flush();
      });
      expect(harness.relations).toHaveBeenCalledTimes(5);
      await act(async () => {
        harness.deferreds.get('$arrival')!.resolve();
        await flush();
      });
      expect(arrival.getContent().body).toBe('resolved');
      expect(harness.relations).toHaveBeenCalledTimes(5);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it('does not drain queued repairs after leaving the thread', async () => {
    const harness = makeHarness();
    const targets = Array.from({ length: 12 }, (_, index) => makePlaceholder(`$leave-${index}`));
    const { props } = makeProps(harness, targets);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(Harness, props));
    });
    await act(async () => {
      renderer.update(React.createElement(Harness, { ...props, threadEvents: [...targets] }));
    });
    act(() => renderer.unmount());
    await act(async () => {
      harness.deferreds.forEach(({ resolve }) => resolve());
      await flush();
    });
    expect(harness.relations).toHaveBeenCalledTimes(4);
    expect(targets.every((event) => event.getContent().body === 'Thinking...')).toBe(true);
    expect(props.beginThreadCacheWrite()).not.toHaveBeenCalled();
  });

  it('reads a same-commit open reset before choosing edit repairs from previously attempted instances', async () => {
    const harness = makeHarness();
    const target = makePlaceholder('$same-commit');
    const { props } = makeProps(harness, [target]);
    let epoch = 0;
    const readEditResetEpoch = () => epoch;
    function OpeningHarness({ reset, events }: { reset: boolean; events: MatrixEvent[] }) {
      // Match the late opening effect installed before the repair effect.
      useEffect(() => {
        if (reset) epoch += 1;
      }, [reset]);
      useThreadEditBackfillController({
        ...props,
        threadEvents: events,
        readEditResetEpoch,
        // Published snapshot still belongs to the render before the open effect.
        editResetEpoch: 0,
      });
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(OpeningHarness, { reset: false, events: [target] }));
      await flush();
      harness.deferreds.get('$same-commit')!.resolve();
      await flush();
    });
    target.makeReplaced(null);
    await act(async () => {
      renderer.update(React.createElement(OpeningHarness, { reset: false, events: [target] }));
      await flush();
    });
    expect(harness.relations).toHaveBeenCalledTimes(1);
    await act(async () => {
      renderer.update(React.createElement(OpeningHarness, { reset: true, events: [target] }));
      await flush();
    });
    expect(harness.relations).toHaveBeenCalledTimes(2);
    await act(async () => {
      harness.deferreds.get('$same-commit')!.resolve();
      await flush();
    });
    target.makeReplaced(null);
    await act(async () => {
      renderer.update(React.createElement(OpeningHarness, { reset: true, events: [target] }));
      await flush();
    });
    expect(harness.relations).toHaveBeenCalledTimes(2);
    act(() => renderer.unmount());
  });

  it('applies the definitive result and does not refetch until the edit epoch resets', async () => {
    // Red-without-fix: the old controller marked attempted synchronously
    // at effect start, so this assertion failed (event already marked
    // while the fetch was still pending).
    const harness = makeHarness();
    const target = makePlaceholder('$t1');
    const { props } = makeProps(harness, [target]);

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(Harness, props));
      await flush();
    });

    // Fetch is in flight (deferred not resolved): must not be marked yet.
    expect(harness.relations).toHaveBeenCalledTimes(1);
    expect(target.replacingEvent()).toBeFalsy();

    // Resolve → definitive outcome → now marked, edit applied.
    await act(async () => {
      harness.deferreds.get('$t1')!.resolve();
      await flush();
    });

    expect(target.replacingEvent()?.getId()).toBe('$edit-$t1');
    await act(async () => {
      renderer.update(React.createElement(Harness, { ...props, threadEvents: [target] }));
      await flush();
    });
    expect(harness.relations).toHaveBeenCalledTimes(1);
    // Reset opens a fresh repair lifetime for the same hydrated instance.
    target.makeReplaced(null);
    await act(async () => {
      renderer.update(
        React.createElement(Harness, { ...props, editResetEpoch: 1, readEditResetEpoch: () => 1 })
      );
      await flush();
    });
    expect(harness.relations).toHaveBeenCalledTimes(2);

    act(() => renderer.unmount());
  });

  it('resolves an event across a threadEvents churn without stranding or duplicating the fetch', async () => {
    // The core band bug. Old code marked attempted UP FRONT and cancelled
    // the in-flight batch on any threadEvents change → the gate refused
    // to re-select the event → permanent placeholder. Fixed code does not
    // cancel on churn (the pending fetch stays valid) and does not mark
    // before it resolves, so the edit is applied by the ORIGINAL fetch —
    // exactly once — despite the churn.
    //   old code : replacingEvent() undefined (stranded)
    //   fixed    : edit applied, relations called exactly 1x
    const harness = makeHarness();
    const target = makePlaceholder('$t2');
    const { props } = makeProps(harness, [target]);

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(Harness, props));
      await flush();
    });
    expect(harness.relations).toHaveBeenCalledTimes(1);

    // Churn while the fetch is pending: must not cancel it, must not
    // launch a duplicate (the id is in-flight).
    await act(async () => {
      renderer.update(React.createElement(Harness, { ...props, threadEvents: [target] }));
      await flush();
    });
    expect(harness.relations).toHaveBeenCalledTimes(1);

    // The original fetch resolves → edit applied.
    await act(async () => {
      harness.deferreds.get('$t2')!.resolve();
      await flush();
    });
    expect(target.replacingEvent()?.getId()).toBe('$edit-$t2');

    act(() => renderer.unmount());
  });

  it('retries after a transient fetch error (never marks a failed fetch attempted)', async () => {
    // A failed fetch is non-definitive: it must not mark attempted, so a
    // later effect run refetches and resolves. Old code marked up front,
    // so a fetch error left the event marked → never retried.
    //   old code : relations 1x, replacingEvent() undefined
    //   fixed    : relations 2x, edit applied
    const harness = makeHarness();
    const target = makePlaceholder('$t4');
    harness.failOnce.add('$t4');
    const { props } = makeProps(harness, [target]);

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(Harness, props));
      await flush();
    });
    // First fetch rejected → not applied, not marked.
    expect(harness.relations).toHaveBeenCalledTimes(1);
    expect(target.replacingEvent()).toBeFalsy();

    // Churn re-runs the effect → refetch (now succeeds) → resolve.
    await act(async () => {
      renderer.update(React.createElement(Harness, { ...props, threadEvents: [target] }));
      await flush();
    });
    expect(harness.relations).toHaveBeenCalledTimes(2);
    await act(async () => {
      harness.deferreds.get('$t4')!.resolve();
      await flush();
    });
    expect(target.replacingEvent()?.getId()).toBe('$edit-$t4');

    act(() => renderer.unmount());
  });

  it('does not refetch an event whose fetch is still in flight when the effect re-runs', async () => {
    // In-flight guard: while a fetch is pending, a churn-triggered effect
    // re-run must NOT launch a duplicate fetch for the same event id
    // (would be a request storm now that the upfront mark is gone). The
    // token-map keyed by event id enforces this across overlapping runs.
    const harness = makeHarness();
    const target = makePlaceholder('$t3');
    const { props } = makeProps(harness, [target]);

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(Harness, props));
      await flush();
    });
    expect(harness.relations).toHaveBeenCalledTimes(1);

    // Churn while the fetch is STILL pending (deferred not resolved):
    // the re-run sees the id in-flight and must issue no second fetch.
    await act(async () => {
      renderer.update(React.createElement(Harness, { ...props, threadEvents: [target] }));
      await flush();
    });
    expect(harness.relations).toHaveBeenCalledTimes(1);

    // Resolve → the (now-cancelled first) fetch releases its claim
    // without marking; a later churn is free to retry.
    await act(async () => {
      harness.deferreds.get('$t3')!.resolve();
      await flush();
    });

    act(() => renderer.unmount());
  });
});

it.each([
  ['matching', ROOM, '$thread-root', false],
  ['other room', '!elsewhere:example.org', '$thread-root', true],
  ['other thread', ROOM, '$elsewhere', true],
  ['no owner', undefined, undefined, true],
] as const)(
  'preserves ordinary repair and delegates approvals only to the %s owner',
  async (_label, roomId, threadId, fetchApproval) => {
    approvalScope = roomId && threadId ? { roomId, threadId } : undefined;
    const harness = makeHarness();
    harness.relations.mockResolvedValue({ events: [] });
    const approval = new MatrixEvent({
      ...makePlaceholder('$approval').event,
      type: 'io.mindroom.tool_approval',
    });
    const { props } = makeProps(harness, [approval, makePlaceholder('$message')]);
    let renderer!: ReactTestRenderer;
    try {
      await act(async () => {
        renderer = create(React.createElement(Harness, props));
        await flush();
      });
      expect(harness.relations.mock.calls.map((call) => call[1])).toEqual(
        fetchApproval ? ['$approval', '$message'] : ['$message']
      );
    } finally {
      act(() => renderer.unmount());
      approvalScope = undefined;
    }
  }
);
