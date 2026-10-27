import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  hasLikelyIncompleteStreamingBody,
  markThreadEditBackfillAttempted,
  shouldFetchThreadEditBackfill,
} from './threadEditBackfill';

const makeMessageEvent = (eventId: string, type = 'm.room.message') =>
  new MatrixEvent({
    content: {
      body: 'hello',
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type,
  });

describe('shouldFetchThreadEditBackfill', () => {
  it('detects likely incomplete streaming placeholders', () => {
    expect(hasLikelyIncompleteStreamingBody('Thinking...')).toBe(true);
    expect(hasLikelyIncompleteStreamingBody('Thinking...  ⋯')).toBe(true);
    expect(hasLikelyIncompleteStreamingBody('Thinking…')).toBe(true);
    expect(hasLikelyIncompleteStreamingBody('Let me do three things')).toBe(false);
    expect(hasLikelyIncompleteStreamingBody(undefined)).toBe(false);
  });

  it('waits for the thread tail before backfilling edits and allows retry after that', () => {
    const attemptedEvents = new WeakMap<MatrixEvent, number>();
    const firstInstance = makeMessageEvent('$target');
    const secondInstance = makeMessageEvent('$target');

    expect(shouldFetchThreadEditBackfill(firstInstance, attemptedEvents, false, true)).toBe(false);
    expect(shouldFetchThreadEditBackfill(secondInstance, attemptedEvents, false, true)).toBe(false);

    expect(shouldFetchThreadEditBackfill(firstInstance, attemptedEvents, true, true)).toBe(true);
    expect(shouldFetchThreadEditBackfill(secondInstance, attemptedEvents, true, true)).toBe(true);
    expect(shouldFetchThreadEditBackfill(firstInstance, attemptedEvents, true, false)).toBe(false);

    markThreadEditBackfillAttempted(firstInstance, attemptedEvents, true);
    expect(shouldFetchThreadEditBackfill(firstInstance, attemptedEvents, true, true)).toBe(false);
  });

  it('skips replaced events before tail load but revalidates them after tail load', () => {
    const attemptedEvents = new WeakMap<MatrixEvent, number>();
    const targetEvent = makeMessageEvent('$target');
    const editEvent = new MatrixEvent({
      content: {
        body: '* edited',
        'm.new_content': {
          body: 'edited',
          msgtype: 'm.text',
        },
        'm.relates_to': {
          event_id: '$target',
          rel_type: 'm.replace',
        },
        msgtype: 'm.text',
      },
      event_id: '$edit',
      origin_server_ts: 2,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
    });
    targetEvent.makeReplaced(editEvent);

    expect(shouldFetchThreadEditBackfill(targetEvent, attemptedEvents, false, true)).toBe(false);
    expect(shouldFetchThreadEditBackfill(targetEvent, attemptedEvents, true, true)).toBe(true);
  });

  it('ignores unsupported event types', () => {
    const attemptedEvents = new WeakMap<MatrixEvent, number>();

    expect(
      shouldFetchThreadEditBackfill(
        makeMessageEvent('$reaction', 'm.reaction'),
        attemptedEvents,
        true,
        true
      )
    ).toBe(false);
  });

  it('always backfills tool approval edits once the thread tail is loaded', () => {
    const attemptedEvents = new WeakMap<MatrixEvent, number>();
    const approvalEvent = makeMessageEvent('$approval', 'io.mindroom.tool_approval');

    expect(shouldFetchThreadEditBackfill(approvalEvent, attemptedEvents, false, true)).toBe(false);
    expect(shouldFetchThreadEditBackfill(approvalEvent, attemptedEvents, true, true)).toBe(true);
    expect(shouldFetchThreadEditBackfill(approvalEvent, attemptedEvents, true, false)).toBe(true);
  });

  it('repairs streaming placeholders on untargeted opens but leaves ordinary messages alone', () => {
    const attemptedEvents = new WeakMap<MatrixEvent, number>();
    const placeholderEvent = new MatrixEvent({
      content: {
        body: 'Thinking...  ⋯',
        msgtype: 'm.text',
      },
      event_id: '$placeholder',
      origin_server_ts: 1,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
    });
    const normalEvent = makeMessageEvent('$normal');

    expect(shouldFetchThreadEditBackfill(placeholderEvent, attemptedEvents, true, false)).toBe(true);
    expect(shouldFetchThreadEditBackfill(normalEvent, attemptedEvents, true, false)).toBe(false);
  });
});
