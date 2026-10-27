import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { RelationType } from 'matrix-js-sdk/lib/@types/event';
import { describe, expect, it } from 'vitest';
import {
  getThreadPrimarySummaryText,
  resolveThreadPresentationSnapshot,
} from './threadPresentation';

const makeRootEvent = (eventId: string, body: string, sender = '@root:example.org', ts = 1) =>
  new MatrixEvent({
    content: {
      body,
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
  });

const makeVoiceRootEvent = (eventId: string, sender = '@root:example.org', ts = 1) =>
  new MatrixEvent({
    content: {
      filename: 'voice-message-2026-04-24T12-02-00.m4a',
      msgtype: 'm.audio',
      'm.voice': {},
      'org.matrix.msc3245.voice': {},
      'm.audio': {
        duration: 1200,
      },
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
  });

const makeThreadReplyEvent = (
  eventId: string,
  threadRootId: string,
  body: string,
  sender = '@alice:example.org',
  ts = 2,
  type = 'm.room.message'
) =>
  ({
    getContent: () => ({
      ...(type === 'm.room.message' ? { body, msgtype: 'm.text' } : {}),
      'm.relates_to': {
        event_id: threadRootId,
        rel_type: RelationType.Thread,
      },
    }),
    getId: () => eventId,
    getRelation: () => ({
      event_id: threadRootId,
      rel_type: RelationType.Thread,
    }),
    getSender: () => sender,
    getTs: () => ts,
    getType: () => type,
    isRedacted: () => false,
    isRedaction: () => false,
    threadRootId,
  } as unknown as MatrixEvent);

const room = {
  getMember: (userId: string) =>
    userId === '@alice:example.org' ? { rawDisplayName: 'Alice' } : undefined,
  getUnfilteredTimelineSet: () => ({
    relations: {
      getChildEventsForEvent: () => undefined,
    },
  }),
} as unknown as Room;

describe('resolveThreadPresentationSnapshot', () => {
  it('derives summary, preview, sender, and count from one shared snapshot', () => {
    const rootEvent = makeRootEvent('$root', 'Root question');
    const hiddenMetadataEvent = makeThreadReplyEvent(
      '$tag',
      '$root',
      '',
      '@alice:example.org',
      3,
      'com.mindroom.thread.tag'
    );
    const visibleReplyEvent = makeThreadReplyEvent(
      '$reply',
      '$root',
      'Latest visible reply',
      '@alice:example.org',
      4
    );

    const presentation = resolveThreadPresentationSnapshot({
      room,
      threadRootId: '$root',
      thread: {
        events: [hiddenMetadataEvent, visibleReplyEvent],
        timeline: [hiddenMetadataEvent, visibleReplyEvent],
      },
      rootEvent,
      preferredSummaryInfo: {
        summaryText: 'Shared summary',
        generatedTs: 5,
        messageCount: 1,
      },
    });

    expect(presentation.summaryText).toBe('Shared summary');
    expect(presentation.rootPreviewText).toBe('Root question');
    expect(presentation.latestReplyPreviewText).toBe('Latest visible reply');
    expect(presentation.lastSenderId).toBe('@alice:example.org');
    expect(presentation.lastSenderDisplayName).toBe('Alice');
    expect(presentation.messageCount).toBe(1);
    expect(getThreadPrimarySummaryText(presentation)).toBe('Shared summary');
  });

  it('does not let stale summary metadata hide newer loaded replies', () => {
    const rootEvent = makeRootEvent('$root', 'Root question');
    const replies = Array.from({ length: 5 }, (_, index) =>
      makeThreadReplyEvent(
        `$reply-${index}`,
        '$root',
        `Reply ${index}`,
        '@alice:example.org',
        index + 2
      )
    );

    const presentation = resolveThreadPresentationSnapshot({
      room,
      threadRootId: '$root',
      thread: {
        events: replies,
        timeline: replies,
      },
      rootEvent,
      preferredSummaryInfo: {
        summaryText: 'Stale summary',
        generatedTs: 5,
        messageCount: 3,
      },
    });

    expect(presentation.summaryText).toBe('Stale summary');
    expect(presentation.messageCount).toBe(5);
  });

  it('falls back to the root preview for zero-reply threads', () => {
    const rootEvent = makeRootEvent('$root', 'Standalone thread root');

    const presentation = resolveThreadPresentationSnapshot({
      room,
      threadRootId: '$root',
      rootEvent,
    });

    expect(presentation.summaryText).toBeUndefined();
    expect(presentation.rootPreviewText).toBe('Standalone thread root');
    expect(presentation.latestReplyPreviewText).toBeUndefined();
    expect(presentation.messageCount).toBe(0);
    expect(getThreadPrimarySummaryText(presentation)).toBe('Standalone thread root');
  });

  it('uses a voice message root preview for zero-reply voice threads', () => {
    const rootEvent = makeVoiceRootEvent('$voice-root');

    const presentation = resolveThreadPresentationSnapshot({
      room,
      threadRootId: '$voice-root',
      rootEvent,
    });

    expect(presentation.summaryText).toBeUndefined();
    expect(presentation.rootPreviewText).toBe('Voice message');
    expect(presentation.latestReplyPreviewText).toBeUndefined();
    expect(presentation.messageCount).toBe(0);
    expect(getThreadPrimarySummaryText(presentation)).toBe('Voice message');
  });
});
