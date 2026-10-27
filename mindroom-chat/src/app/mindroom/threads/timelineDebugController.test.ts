import React, { useEffect } from 'react';
import type { Room } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useTimelineDebugRangeController,
  useTimelineDebugTraceIds,
} from './timelineDebugController';

const debugMock = vi.hoisted(() => ({
  calls: [] as Array<[string | undefined, string, Record<string, unknown> | undefined]>,
}));

vi.mock('./timelineDebug', () => ({
  createTimelineDebugTrace: vi.fn(
    (scope: string, roomId: string, threadId?: string) => `${scope}:${roomId}:${threadId ?? ''}`
  ),
  logTimelineDebug: vi.fn(
    (traceId: string | undefined, phase: string, payload?: Record<string, unknown>) => {
      debugMock.calls.push([traceId, phase, payload]);
    }
  ),
}));

const makeRoom = (roomId = '!room:example.org') => ({ roomId }) as Room;

const TraceHarness = ({
  eventId,
  onTraceIds,
  room,
  threadId,
}: {
  eventId?: string;
  onTraceIds: (ids: ReturnType<typeof useTimelineDebugTraceIds>) => void;
  room: Room;
  threadId?: string;
}) => {
  const traceIds = useTimelineDebugTraceIds({ eventId, room, threadId });
  useEffect(() => {
    onTraceIds(traceIds);
  }, [onTraceIds, traceIds]);
  return null;
};

const RangeHarness = ({
  threadId,
  threadDebugTraceId,
}: {
  threadDebugTraceId?: string;
  threadId?: string;
}) => {
  useTimelineDebugRangeController({
    activeTimelineRange: { start: 2, end: 7 },
    canPaginateThreadBack: true,
    canPaginateThreadFront: false,
    eventsLength: 20,
    filteredLength: 11,
    renderableEventCount: 12,
    roomDebugTraceId: 'room-trace',
    roomSurfaceEventCount: 10,
    threadDebugTraceId,
    threadEventCount: 5,
    threadId,
    threadInitialCacheHydrated: true,
    threadInitialRenderMode: 'cached',
    threadOverviewCount: 4,
    threadTailLoaded: false,
    threadTimelineTick: 3,
    useSurfacePreloadTarget: true,
  });
  return null;
};

describe('timelineDebugController', () => {
  beforeEach(() => {
    debugMock.calls = [];
  });

  it('creates stable room and thread trace ids and logs route init phases', async () => {
    const traceIds: Array<ReturnType<typeof useTimelineDebugTraceIds>> = [];

    await act(async () => {
      create(
        React.createElement(TraceHarness, {
          eventId: '$focus',
          onTraceIds: (ids) => traceIds.push(ids),
          room: makeRoom(),
          threadId: '$thread',
        })
      );
    });

    expect(traceIds[0]).toEqual({
      roomDebugTraceId: 'room-open:!room:example.org:',
      threadDebugTraceId: 'thread-open:!room:example.org:$thread',
    });
    expect(debugMock.calls).toEqual([
      [
        'room-open:!room:example.org:',
        'init',
        { eventId: '$focus', roomId: '!room:example.org', threadId: '$thread' },
      ],
      [
        'thread-open:!room:example.org:$thread',
        'init',
        { eventId: '$focus', roomId: '!room:example.org', threadId: '$thread' },
      ],
    ]);
  });

  it('logs room-surface metadata only outside thread routes', async () => {
    await act(async () => {
      create(React.createElement(RangeHarness, {}));
    });

    expect(debugMock.calls).toEqual([
      [
        'room-trace',
        'room-surface',
        expect.objectContaining({
          activeRangeEnd: 7,
          activeRangeStart: 2,
          preloadTarget: 'surface',
          visibleCount: 5,
        }),
      ],
    ]);
  });

  it('logs thread range metadata only inside thread routes', async () => {
    await act(async () => {
      create(
        React.createElement(RangeHarness, {
          threadDebugTraceId: 'thread-trace',
          threadId: '$thread',
        })
      );
    });

    expect(debugMock.calls).toEqual([
      [
        'thread-trace',
        'thread-range',
        expect.objectContaining({
          canPaginateThreadBack: true,
          filteredLength: 11,
          initialRenderMode: 'cached',
          renderedCount: 5,
        }),
      ],
    ]);
  });
});
