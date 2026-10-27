import React from 'react';
import { Direction } from 'matrix-js-sdk';
import { act } from 'react-test-renderer';
import { ErrorBoundary } from 'react-error-boundary';
import { describe, expect, it, vi } from 'vitest';
import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  getClickableByText,
  makeEvent,
  makeRoom,
  matrixClientMock,
  threadRenderStateMock,
} from '../test-utils/RoomTimeline.test.shared';

describe('new thread history', () => {
  it.each(['empty terminal page', 'older reply', 'request failure'])(
    'checks fallback history on first open: %s',
    async (outcome) => {
      const { reconcileThreadBackwardPagination } = await import('../threadPaginationUtils');
      const paginationUtils = await vi.importActual<typeof import('../threadPaginationUtils')>(
        '../threadPaginationUtils'
      );
      vi.mocked(reconcileThreadBackwardPagination).mockImplementation(
        paginationUtils.reconcileThreadBackwardPagination
      );
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const threadId = '$new-root';
      const root = makeEvent(threadId, { ts: 1 });
      const reply = makeEvent('$older-reply', {
        ts: 2,
        threadRootId: threadId,
        relation: { rel_type: 'm.thread', event_id: threadId },
      });
      const latestReply = makeEvent('$latest-reply', {
        ts: 3,
        threadRootId: threadId,
        relation: { rel_type: 'm.thread', event_id: threadId },
      });
      const room = makeRoom({ liveEvents: [root] });
      const renderError = vi.fn();
      threadRenderStateMock.threadEvents = [root] as never;

      matrixClientMock.getThreadTimeline.mockRejectedValue(new Error('context request failed'));
      matrixClientMock.getEventMapper.mockReturnValue((event: unknown) =>
        event === latestReply.event ? latestReply : event
      );
      // The fallback can return a cursor on its final nonempty page. The
      // separate background reconciler returns no events in this fixture.
      matrixClientMock.fetchRelations.mockImplementation(async (_roomId, _threadId, relType) =>
        relType === 'm.thread'
          ? { chunk: [latestReply.event], next_batch: 'older-cursor' }
          : { chunk: [], next_batch: null }
      );
      matrixClientMock.paginateEventTimeline.mockImplementation(async (timeline) => {
        if (outcome === 'request failure') throw new Error('pagination request failed');
        const thread = room.getThread(threadId) as ReturnType<typeof room.createThread>;
        if (outcome === 'older reply') thread.addEvents([reply], true);
        timeline.setPaginationToken(null, Direction.Backward);
        return false;
      });

      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      let renderer: ReturnType<typeof create> | undefined;
      try {
        await act(async () => {
          renderer = create(
            React.createElement(
              ErrorBoundary,
              { fallback: null, onError: renderError },
              React.createElement(ControlledRoomTimeline, { room, threadId })
            )
          );
          await flushAsyncWork(30);
        });

        expect(renderError).not.toHaveBeenCalled();
        if (outcome === 'request failure') {
          expect(getClickableByText(renderer!, 'Load Older Messages').props.onClick).toEqual(
            expect.any(Function)
          );
        } else {
          expect(() => getClickableByText(renderer!, 'Load Older Messages')).toThrow();
        }
        expect(matrixClientMock.paginateEventTimeline).toHaveBeenCalledOnce();
        if (outcome === 'older reply') {
          expect(threadRenderStateMock.setSupplementalThreadEvents).toHaveBeenCalledWith(
            threadId,
            expect.arrayContaining([reply])
          );
        }
      } finally {
        await act(async () => {
          renderer?.unmount();
          await flushAsyncWork(2);
        });
      }
    }
  );
});
