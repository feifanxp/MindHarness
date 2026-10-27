import { Direction, MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  buildCompactZeroReplyRootData,
  buildCompactThreadRootData,
  getCompactCachedThreadActivityTs,
  getCompactCachedThreadRootPreviewInfo,
  getCompactThreadRootBodyPreviewText,
  isZeroReplyStandaloneThreadRootEvent,
  mergeCompactThreadRootData,
  pickPreferredThreadRootPreviewText,
} from './compactThreadRootData';

const makeEvent = (
  eventId: string,
  body: string | undefined,
  editedBody?: string,
  relation?: { event_id: string; rel_type: string; ['m.in_reply_to']?: { event_id: string } },
  options?: {
    ts?: number;
    type?: string;
    msgtype?: string;
    content?: Record<string, unknown>;
    isRedacted?: boolean;
    threadRootId?: string;
    isSending?: boolean;
  }
) =>
  ({
    event: { event_id: eventId },
    getContent: () => {
      if (options?.content) return options.content;

      return editedBody
        ? ({
            ...(typeof body === 'string' ? { body } : {}),
            ...(relation ? { 'm.relates_to': relation } : {}),
            'm.new_content': {
              body: editedBody,
            },
          } as Record<string, unknown>)
        : {
            ...(typeof body === 'string' ? { body } : {}),
            ...(options?.msgtype ? { msgtype: options.msgtype } : {}),
            ...(relation ? { 'm.relates_to': relation } : {}),
          };
    },
    getId: () => eventId,
    getRelation: () => relation,
    getType: () => options?.type ?? 'm.room.message',
    getSender: () => '@bot:mindroom.chat',
    getTs: () => options?.ts ?? 1,
    getUnsigned: () => undefined,
    isSending: () => options?.isSending ?? false,
    isRedacted: () => options?.isRedacted ?? false,
    threadRootId: options?.threadRootId,
    replacingEvent: () =>
      editedBody
        ? ({
            getId: () => `${eventId}-edit`,
            getTs: () => 2,
            getSender: () => '@bot:mindroom.chat',
            getUnsigned: () => undefined,
            getContent: () => ({
              body: `* ${editedBody}`,
              'm.new_content': {
                body: editedBody,
              },
            }),
          } as never)
        : undefined,
  } as never);

const makeThread = (id: string, rootEvent?: ReturnType<typeof makeEvent>) =>
  ({
    id,
    rootEvent,
  } as never);

describe('buildCompactThreadRootData', () => {
  const makeRoom = (eventsById?: Record<string, ReturnType<typeof makeEvent>>) =>
    ({
      getThread: () => undefined,
      getUnfilteredTimelineSet: () =>
        ({
          findEventById: (eventId: string) => eventsById?.[eventId],
          relations: {
            getChildEventsForEvent: () => undefined,
          },
        } as never),
    } as never);

  it('keeps room-surface thread roots first and appends unseen thread-list roots', () => {
    const data = buildCompactThreadRootData({
      room: makeRoom(),
      visibleIds: ['$visible-a', '$visible-b'],
      visibleIndexMap: new Map([
        ['$visible-a', 2],
        ['$visible-b', 5],
      ]),
      visibleBodyMap: new Map([['$visible-a', 'Visible A']]),
      threads: [
        makeThread('$visible-b'),
        { id: '$thread-c', length: 2 } as never,
        { id: '$thread-d', length: 1 } as never,
      ],
    });

    expect(data.ids).toEqual(['$visible-a', '$visible-b', '$thread-c', '$thread-d']);
    expect(data.indexMap.get('$thread-c')).toBe(6);
    expect(data.indexMap.get('$thread-d')).toBe(7);
  });

  it('hydrates missing body previews from thread root events and prefers edited bodies', () => {
    const data = buildCompactThreadRootData({
      room: makeRoom(),
      visibleIds: [],
      visibleIndexMap: new Map(),
      visibleBodyMap: new Map(),
      threads: [
        {
          id: '$thread-a',
          rootEvent: makeEvent('$thread-a', 'Original root', 'Edited root'),
          length: 1,
        } as never,
        {
          id: '$thread-b',
          rootEvent: makeEvent(
            '$thread-b',
            '> <@bot:mindroom.chat> reply quote\n> continued\n\nVisible body'
          ),
          length: 1,
        } as never,
      ],
    });

    expect(data.bodyMap.get('$thread-a')).toBe('Edited root');
    expect(data.bodyMap.get('$thread-b')).toBe('Visible body');
  });

  it('labels stable voice roots instead of exposing filename bodies', () => {
    const filename = 'voice-message-2026-04-24T12-00-00.m4a';
    const voiceEvent = makeEvent('$voice', filename, undefined, undefined, {
      content: {
        body: filename,
        filename,
        msgtype: 'm.audio',
        'm.voice': {},
        'm.audio': {
          duration: 1400,
        },
      },
    });

    expect(isZeroReplyStandaloneThreadRootEvent(voiceEvent)).toBe(true);
    expect(getCompactThreadRootBodyPreviewText(voiceEvent)).toBe('Voice message');
  });

  it('labels unstable voice roots with no useful body in zero-reply compact data', () => {
    const voiceEvent = makeEvent('$voice-empty-body', undefined, undefined, undefined, {
      content: {
        filename: 'voice-message-2026-04-24T12-01-00.m4a',
        msgtype: 'm.audio',
        'org.matrix.msc3245.voice': {},
        'org.matrix.msc1767.audio': {
          duration: 900,
        },
      },
    });

    expect(getCompactThreadRootBodyPreviewText(voiceEvent)).toBe('Voice message');

    const data = buildCompactZeroReplyRootData({
      room: makeRoom(),
      roomSurfaceEntries: [{ event: voiceEvent, absoluteIndex: 2 }],
      knownThreadRootIds: [],
      now: 10_000,
    });

    expect(data.ids).toEqual(['$voice-empty-body']);
    expect(data.indexMap.get('$voice-empty-body')).toBe(2);
    expect(data.bodyMap.get('$voice-empty-body')).toBe('Voice message');
  });

  it('keeps text root previews unchanged', () => {
    const textEvent = makeEvent('$text', 'Normal text thread root');

    expect(getCompactThreadRootBodyPreviewText(textEvent)).toBe('Normal text thread root');
  });

  it('does not append server thread-list roots that have no actual reply activity', () => {
    const data = buildCompactThreadRootData({
      room: makeRoom(),
      visibleIds: ['$visible-a'],
      visibleIndexMap: new Map([['$visible-a', 0]]),
      visibleBodyMap: new Map(),
      threads: [
        makeThread('$no-replies', makeEvent('$no-replies', 'Thinking...')),
        {
          id: '$has-replies',
          rootEvent: makeEvent('$has-replies', 'Real thread'),
          length: 3,
        } as never,
      ],
    });

    expect(data.ids).toEqual(['$visible-a', '$has-replies']);
    expect(data.ids).not.toContain('$no-replies');
  });

  it('does not resolve roots for server threads without reply activity', () => {
    const findEventById = vi.fn();

    const data = buildCompactThreadRootData({
      room: {
        getThread: () => undefined,
        getUnfilteredTimelineSet: () => ({ findEventById }),
      } as never,
      visibleIds: [],
      visibleIndexMap: new Map(),
      visibleBodyMap: new Map(),
      threads: [makeThread('$no-replies', makeEvent('$no-replies', 'Thinking...'))],
    });

    expect(data.ids).toEqual([]);
    expect(findEventById).not.toHaveBeenCalled();
  });

  it('does not append a server thread whose root and only reply are redacted', () => {
    const redactedRoot = makeEvent('$redacted-root', 'Deleted root', undefined, undefined, {
      isRedacted: true,
    });
    const redactedReply = makeEvent(
      '$redacted-reply',
      'Deleted reply',
      undefined,
      {
        event_id: '$redacted-root',
        rel_type: 'm.thread',
      },
      { isRedacted: true, threadRootId: '$redacted-root' }
    );

    const data = buildCompactThreadRootData({
      room: makeRoom({ '$redacted-root': redactedRoot }),
      visibleIds: [],
      visibleIndexMap: new Map(),
      visibleBodyMap: new Map(),
      threads: [
        {
          id: '$redacted-root',
          rootEvent: redactedRoot,
          events: [redactedReply],
          length: 1,
        } as never,
      ],
    });

    expect(data.ids).toEqual([]);
  });

  it.each([
    [false, ['$redacted-root']],
    [true, []],
  ])(
    'treats an empty history token as complete only once the SDK thread loaded (loaded=%s)',
    (initialEventsFetched, ids) => {
      const redactedRoot = makeEvent('$redacted-root', 'Deleted root', undefined, undefined, {
        isRedacted: true,
      });
      const redactedReply = makeEvent(
        '$redacted-reply',
        'Deleted reply',
        undefined,
        {
          event_id: '$redacted-root',
          rel_type: 'm.thread',
        },
        { isRedacted: true, threadRootId: '$redacted-root' }
      );
      const liveTimeline = {
        getEvents: () => [redactedReply],
        getPaginationToken: () => null,
        getNeighbouringTimeline: () => null,
      };

      const data = buildCompactThreadRootData({
        room: makeRoom({ '$redacted-root': redactedRoot }),
        visibleIds: [],
        visibleIndexMap: new Map(),
        visibleBodyMap: new Map(),
        threads: [
          {
            id: '$redacted-root',
            rootEvent: redactedRoot,
            events: [redactedReply],
            length: 1,
            initialEventsFetched,
            getUnfilteredTimelineSet: () => ({ getLiveTimeline: () => liveTimeline }),
          } as never,
        ],
      });

      expect(data.ids).toEqual(ids);
    }
  );

  it('keeps a redacted root when a visible reply remains', () => {
    const redactedRoot = makeEvent('$redacted-root', 'Deleted root', undefined, undefined, {
      isRedacted: true,
    });
    const visibleReply = makeEvent(
      '$visible-reply',
      'Remaining reply',
      undefined,
      {
        event_id: '$redacted-root',
        rel_type: 'm.thread',
      },
      { threadRootId: '$redacted-root' }
    );

    const data = buildCompactThreadRootData({
      room: makeRoom({ '$redacted-root': redactedRoot }),
      visibleIds: [],
      visibleIndexMap: new Map(),
      visibleBodyMap: new Map(),
      threads: [
        {
          id: '$redacted-root',
          rootEvent: redactedRoot,
          events: [visibleReply],
          length: 1,
        } as never,
      ],
    });

    expect(data.ids).toEqual(['$redacted-root']);
  });

  it('keeps a redacted root when its visible replyToEvent is outside loaded events', () => {
    const redactedRoot = makeEvent('$redacted-root', 'Deleted root', undefined, undefined, {
      isRedacted: true,
    });
    const redactedReply = makeEvent(
      '$redacted-reply',
      'Deleted reply',
      undefined,
      {
        event_id: '$redacted-root',
        rel_type: 'm.thread',
      },
      { isRedacted: true, threadRootId: '$redacted-root' }
    );
    const visibleReply = makeEvent(
      '$visible-reply',
      'Pending reply',
      undefined,
      {
        event_id: '$redacted-root',
        rel_type: 'm.thread',
      },
      { threadRootId: '$redacted-root' }
    );

    const data = buildCompactThreadRootData({
      room: makeRoom({ '$redacted-root': redactedRoot }),
      visibleIds: [],
      visibleIndexMap: new Map(),
      visibleBodyMap: new Map(),
      threads: [
        {
          id: '$redacted-root',
          rootEvent: redactedRoot,
          events: [redactedReply],
          replyToEvent: visibleReply,
          length: 2,
        } as never,
      ],
    });

    expect(data.ids).toEqual(['$redacted-root']);
  });

  it('keeps a redacted root when a visible tool approval reply remains', () => {
    const redactedRoot = makeEvent('$redacted-root', 'Deleted root', undefined, undefined, {
      isRedacted: true,
    });
    const approvalReply = makeEvent(
      '$approval-reply',
      undefined,
      undefined,
      {
        event_id: '$redacted-root',
        rel_type: 'm.thread',
      },
      {
        type: 'io.mindroom.tool_approval',
        content: { approval_id: 'approval-1', status: 'pending' },
        threadRootId: '$redacted-root',
      }
    );

    const data = buildCompactThreadRootData({
      room: makeRoom({ '$redacted-root': redactedRoot }),
      visibleIds: [],
      visibleIndexMap: new Map(),
      visibleBodyMap: new Map(),
      threads: [
        {
          id: '$redacted-root',
          rootEvent: redactedRoot,
          events: [approvalReply],
          length: 1,
        } as never,
      ],
    });

    expect(data.ids).toEqual(['$redacted-root']);
  });

  it('keeps a redacted root when an older linked timeline has a visible reply', () => {
    const redactedRoot = makeEvent('$redacted-root', 'Deleted root', undefined, undefined, {
      isRedacted: true,
    });
    const redactedReply = makeEvent(
      '$redacted-reply',
      'Deleted reply',
      undefined,
      {
        event_id: '$redacted-root',
        rel_type: 'm.thread',
      },
      { isRedacted: true, threadRootId: '$redacted-root' }
    );
    const visibleReply = makeEvent(
      '$visible-reply',
      'Older visible reply',
      undefined,
      {
        event_id: '$redacted-root',
        rel_type: 'm.thread',
      },
      { threadRootId: '$redacted-root' }
    );
    let liveTimeline: {
      getEvents: () => MatrixEvent[];
      getNeighbouringTimeline: (direction: Direction) => unknown;
      getPaginationToken: (direction: Direction) => string | null;
    };
    const olderTimeline = {
      getEvents: () => [visibleReply],
      getNeighbouringTimeline: (direction: Direction) =>
        direction === Direction.Forward ? liveTimeline : null,
      getPaginationToken: () => null,
    };
    liveTimeline = {
      getEvents: () => [redactedReply],
      getNeighbouringTimeline: (direction: Direction) =>
        direction === Direction.Backward ? olderTimeline : null,
      getPaginationToken: () => null,
    };

    const data = buildCompactThreadRootData({
      room: makeRoom({ '$redacted-root': redactedRoot }),
      visibleIds: [],
      visibleIndexMap: new Map(),
      visibleBodyMap: new Map(),
      threads: [
        {
          id: '$redacted-root',
          rootEvent: redactedRoot,
          events: [redactedReply],
          length: 2,
          getUnfilteredTimelineSet: () => ({ getLiveTimeline: () => liveTimeline }),
        } as never,
      ],
    });

    expect(data.ids).toEqual(['$redacted-root']);
  });

  it('hides a redacted root when only complete linked history contains redacted replies', () => {
    const redactedRoot = makeEvent('$redacted-root', 'Deleted root', undefined, undefined, {
      isRedacted: true,
    });
    const redactedReply = makeEvent(
      '$redacted-reply',
      'Deleted reply',
      undefined,
      {
        event_id: '$redacted-root',
        rel_type: 'm.thread',
      },
      { isRedacted: true, threadRootId: '$redacted-root' }
    );
    let liveTimeline: {
      getEvents: () => MatrixEvent[];
      getNeighbouringTimeline: (direction: Direction) => unknown;
      getPaginationToken: (direction: Direction) => string | null;
    };
    const olderTimeline = {
      getEvents: () => [redactedReply],
      getNeighbouringTimeline: (direction: Direction) =>
        direction === Direction.Forward ? liveTimeline : null,
      getPaginationToken: () => null,
    };
    liveTimeline = {
      getEvents: () => [],
      getNeighbouringTimeline: (direction: Direction) =>
        direction === Direction.Backward ? olderTimeline : null,
      getPaginationToken: () => null,
    };

    const data = buildCompactThreadRootData({
      room: makeRoom({ '$redacted-root': redactedRoot }),
      visibleIds: [],
      visibleIndexMap: new Map(),
      visibleBodyMap: new Map(),
      threads: [
        {
          id: '$redacted-root',
          rootEvent: redactedRoot,
          events: [],
          length: 1,
          initialEventsFetched: true,
          getUnfilteredTimelineSet: () => ({ getLiveTimeline: () => liveTimeline }),
        } as never,
      ],
    });

    expect(data.ids).toEqual([]);
  });

  it('keeps a redacted root while older thread history remains unloaded', () => {
    const redactedRoot = makeEvent('$redacted-root', 'Deleted root', undefined, undefined, {
      isRedacted: true,
    });
    const redactedReply = makeEvent(
      '$redacted-reply',
      'Deleted reply',
      undefined,
      {
        event_id: '$redacted-root',
        rel_type: 'm.thread',
      },
      { isRedacted: true, threadRootId: '$redacted-root' }
    );
    const liveTimeline = {
      getEvents: () => [redactedReply],
      getNeighbouringTimeline: () => null,
      getPaginationToken: (direction: Direction) =>
        direction === Direction.Backward ? 'older-history' : null,
    };

    const data = buildCompactThreadRootData({
      room: makeRoom({ '$redacted-root': redactedRoot }),
      visibleIds: [],
      visibleIndexMap: new Map(),
      visibleBodyMap: new Map(),
      threads: [
        {
          id: '$redacted-root',
          rootEvent: redactedRoot,
          events: [redactedReply],
          length: 2,
          getUnfilteredTimelineSet: () => ({ getLiveTimeline: () => liveTimeline }),
        } as never,
      ],
    });

    expect(data.ids).toEqual(['$redacted-root']);
  });

  it('does not append nested thread replies from the server thread list as compact roots', () => {
    const nestedThreadRoot = makeEvent('$nested-thread-root', 'Thinking... ⋯', undefined, {
      event_id: '$parent-thread-root',
      rel_type: 'm.thread',
      'm.in_reply_to': {
        event_id: '$reply-inside-parent-thread',
      },
    });

    const data = buildCompactThreadRootData({
      room: makeRoom({ '$nested-thread-root': nestedThreadRoot }),
      visibleIds: ['$visible-a'],
      visibleIndexMap: new Map([['$visible-a', 0]]),
      visibleBodyMap: new Map(),
      threads: [
        {
          id: '$nested-thread-root',
          rootEvent: nestedThreadRoot,
          length: 1,
        } as never,
      ],
    });

    expect(data.ids).toEqual(['$visible-a']);
    expect(data.ids).not.toContain('$nested-thread-root');
  });

  it('prefers the edited room event over the stale thread-list root event', () => {
    const staleThreadRoot = makeEvent('$thread-a', 'Thinking...  ⋯');
    const roomRootEvent = makeEvent(
      '$thread-a',
      'Thinking...  ⋯',
      'Let me do three things: finish the origin tagging, file CINNY-010, and spawn a sub-agent.'
    );

    const data = buildCompactThreadRootData({
      room: makeRoom({ '$thread-a': roomRootEvent }),
      visibleIds: [],
      visibleIndexMap: new Map(),
      visibleBodyMap: new Map(),
      threads: [
        {
          id: '$thread-a',
          rootEvent: staleThreadRoot,
          length: 1,
        } as never,
      ],
    });

    expect(data.bodyMap.get('$thread-a')).toContain('Let me do three things');
    expect(data.bodyMap.get('$thread-a')).not.toContain('Thinking...');
  });

  it('prefers fresher root previews over stale streaming placeholders', () => {
    expect(
      pickPreferredThreadRootPreviewText({
        preferredPreviewText: 'Final edited body',
        fallbackPreviewText: 'Thinking...  ⋯',
      })
    ).toBe('Final edited body');

    expect(
      pickPreferredThreadRootPreviewText({
        preferredPreviewText: 'Thinking...  ⋯',
        fallbackPreviewText: 'Recovered from cache',
      })
    ).toBe('Recovered from cache');
  });

  it('collects standalone room messages as zero-reply compact roots regardless of age', () => {
    const now = 10_000_000;
    const recentMessage = makeEvent('$recent', 'Recent standalone root', undefined, undefined, {
      ts: now - 1_000,
    });
    const oldMessage = makeEvent('$old', 'Older standalone root', undefined, undefined, {
      ts: 1_000,
    });
    const noticeMessage = makeEvent('$notice', 'Notice root', undefined, undefined, {
      ts: now - 1_000,
      msgtype: 'm.notice',
    });
    const knownThreadRoot = makeEvent('$known-thread', 'Known thread root', undefined, undefined, {
      ts: now - 1_000,
    });
    const editEvent = makeEvent(
      '$edit',
      '* edited',
      undefined,
      {
        event_id: '$recent',
        rel_type: 'm.replace',
      },
      { ts: now - 1_000 }
    );
    const nestedReply = makeEvent(
      '$nested-reply',
      'Nested reply',
      undefined,
      {
        event_id: '$parent-root',
        rel_type: 'm.thread',
        'm.in_reply_to': { event_id: '$parent-reply' },
      },
      { ts: now - 1_000, threadRootId: '$parent-root' }
    );
    const redactedMessage = makeEvent('$redacted', 'Redacted root', undefined, undefined, {
      ts: now - 1_000,
      isRedacted: true,
    });

    const data = buildCompactZeroReplyRootData({
      room: makeRoom(),
      roomSurfaceEntries: [
        { event: knownThreadRoot, absoluteIndex: 0 },
        { event: recentMessage, absoluteIndex: 1 },
        { event: oldMessage, absoluteIndex: 2 },
        { event: noticeMessage, absoluteIndex: 3 },
        { event: editEvent, absoluteIndex: 4 },
        { event: nestedReply, absoluteIndex: 5 },
        { event: redactedMessage, absoluteIndex: 6 },
      ],
      knownThreadRootIds: ['$known-thread'],
      now,
    });

    expect(data.ids).toEqual(['$recent', '$old']);
    expect(data.indexMap.get('$recent')).toBe(1);
    expect(data.indexMap.get('$old')).toBe(2);
    expect(data.bodyMap.get('$recent')).toBe('Recent standalone root');
    expect(data.bodyMap.get('$old')).toBe('Older standalone root');
  });

  it('recognizes standalone room messages as zero-reply thread roots regardless of age', () => {
    const now = 10_000_000;

    expect(
      isZeroReplyStandaloneThreadRootEvent(
        makeEvent('$recent', 'Recent standalone root', undefined, undefined, {
          ts: now - 1_000,
        }),
        now
      )
    ).toBe(true);
    expect(
      isZeroReplyStandaloneThreadRootEvent(
        makeEvent('$old', 'Older standalone root', undefined, undefined, {
          ts: 1_000,
        }),
        now
      )
    ).toBe(true);
    expect(
      isZeroReplyStandaloneThreadRootEvent(
        makeEvent('$notice', 'Notice root', undefined, undefined, {
          ts: now - 1_000,
          msgtype: 'm.notice',
        }),
        now
      )
    ).toBe(false);
    expect(
      isZeroReplyStandaloneThreadRootEvent(
        makeEvent(
          '$edit',
          '* edited',
          undefined,
          {
            event_id: '$recent',
            rel_type: 'm.replace',
          },
          {
            ts: now - 1_000,
          }
        ),
        now
      )
    ).toBe(false);
    expect(
      isZeroReplyStandaloneThreadRootEvent(
        makeEvent('~pending', 'Pending local echo root', undefined, undefined, {
          ts: 0,
          isSending: true,
        }),
        now
      )
    ).toBe(true);
    expect(
      isZeroReplyStandaloneThreadRootEvent(
        makeEvent('~pending-encrypted', 'Pending encrypted local echo root', undefined, undefined, {
          ts: 0,
          type: 'm.room.encrypted',
          isSending: true,
        }),
        now
      )
    ).toBe(true);
  });

  it('merges zero-reply compact roots back into absolute timeline order', () => {
    const merged = mergeCompactThreadRootData(
      {
        ids: ['$thread-root', '$sdk-thread'],
        indexMap: new Map([
          ['$thread-root', 4],
          ['$sdk-thread', 12],
        ]),
        bodyMap: new Map([['$thread-root', 'Existing thread']]),
        sourceTsMap: new Map([['$thread-root', 4]]),
      },
      {
        ids: ['$zero-reply'],
        indexMap: new Map([['$zero-reply', 8]]),
        bodyMap: new Map([['$zero-reply', 'New standalone message']]),
        sourceTsMap: new Map([['$zero-reply', 8]]),
      }
    );

    expect(merged.ids).toEqual(['$thread-root', '$zero-reply', '$sdk-thread']);
    expect(merged.bodyMap.get('$zero-reply')).toBe('New standalone message');
  });

  it('hydrates edited compact root previews from cached thread pages', () => {
    const preview = getCompactCachedThreadRootPreviewInfo({
      threadId: '$thread-a',
      cachedPage: {
        rootEvent: {
          event_id: '$thread-a',
          origin_server_ts: 1,
          sender: '@bot:mindroom.chat',
          type: 'm.room.message',
          content: {
            body: 'Thinking...  ⋯',
            msgtype: 'm.text',
          },
        },
        events: [
          {
            event_id: '$thread-a-edit',
            origin_server_ts: 2,
            sender: '@bot:mindroom.chat',
            type: 'm.room.message',
            content: {
              body: '* Edited root',
              msgtype: 'm.text',
              'm.new_content': {
                body: 'Edited root',
                msgtype: 'm.text',
              },
              'm.relates_to': {
                event_id: '$thread-a',
                rel_type: 'm.replace',
              },
            },
          },
          {
            event_id: '$thread-a-reply',
            origin_server_ts: 3,
            sender: '@bot:mindroom.chat',
            type: 'm.room.message',
            content: {
              body: '✅ Generation stopped',
              msgtype: 'm.text',
              'm.relates_to': {
                event_id: '$thread-a',
                rel_type: 'm.thread',
                'm.in_reply_to': {
                  event_id: '$thread-a',
                },
              },
            },
          },
        ],
      },
      mapper: (rawEvent) => new MatrixEvent(rawEvent),
    });

    expect(preview).toEqual({ previewText: 'Edited root', sourceTs: 2 });
  });

  it('hydrates latest activity timestamps from cached thread pages', () => {
    const activityTs = getCompactCachedThreadActivityTs({
      threadId: '$thread-a',
      cachedPage: {
        rootEvent: {
          event_id: '$thread-a',
          origin_server_ts: 1,
          sender: '@bot:mindroom.chat',
          type: 'm.room.message',
          content: {
            body: 'Original root',
            msgtype: 'm.text',
          },
        },
        events: [
          {
            event_id: '$thread-a-reply',
            origin_server_ts: 3,
            sender: '@bot:mindroom.chat',
            type: 'm.room.message',
            content: {
              body: 'Reply',
              msgtype: 'm.text',
              'm.relates_to': {
                event_id: '$thread-a',
                rel_type: 'm.thread',
                'm.in_reply_to': {
                  event_id: '$thread-a',
                },
              },
            },
          },
          {
            event_id: '$thread-a-reply-edit',
            origin_server_ts: 6,
            sender: '@bot:mindroom.chat',
            type: 'm.room.message',
            content: {
              body: '* Reply edited',
              msgtype: 'm.text',
              'm.new_content': {
                body: 'Reply edited',
                msgtype: 'm.text',
              },
              'm.relates_to': {
                event_id: '$thread-a-reply',
                rel_type: 'm.replace',
              },
            },
          },
          {
            event_id: '$thread-a-reaction',
            origin_server_ts: 9,
            sender: '@bot:mindroom.chat',
            type: 'm.reaction',
            content: {
              'm.relates_to': {
                event_id: '$thread-a-reply',
                rel_type: 'm.annotation',
                key: '👍',
              },
            },
          },
        ],
      },
      mapper: (rawEvent) => new MatrixEvent(rawEvent),
    });

    expect(activityTs).toBe(6);
  });
});

describe('isZeroReplyStandaloneThreadRootEvent — parametric msgtype regression locks (CINNY-088)', () => {
  const NOW = 10_000_000;

  it.each([
    ['m.text', { body: 'Hello world', msgtype: 'm.text' }],
    [
      'm.audio (voice)',
      {
        body: 'voice-2026-05-13.m4a',
        filename: 'voice-2026-05-13.m4a',
        msgtype: 'm.audio',
        'm.voice': {},
        'm.audio': { duration: 1200 },
      },
    ],
    [
      'm.audio (no m.voice marker)',
      {
        body: 'audio.mp3',
        filename: 'audio.mp3',
        msgtype: 'm.audio',
      },
    ],
    [
      'm.image',
      {
        body: 'image.png',
        filename: 'image.png',
        msgtype: 'm.image',
      },
    ],
    [
      'm.video',
      {
        body: 'video.mp4',
        filename: 'video.mp4',
        msgtype: 'm.video',
      },
    ],
    [
      'm.file',
      {
        body: 'document.pdf',
        filename: 'document.pdf',
        msgtype: 'm.file',
      },
    ],
    ['m.emote', { body: 'waves', msgtype: 'm.emote' }],
    [
      'm.location',
      {
        body: 'Pin drop',
        msgtype: 'm.location',
        geo_uri: 'geo:37.7749,-122.4194',
      },
    ],
    // Regression lock: future or custom MindRoom msgtypes must remain eligible.
    // The selector gates on event TYPE, not content.msgtype, so any new msgtype
    // added by MindRoom (or any other future Matrix client) must pass through.
    [
      'custom io.mindroom.custom_demo msgtype',
      { body: 'Custom payload', msgtype: 'io.mindroom.custom_demo' },
    ],
  ])(
    'returns true for standalone room-level %s events',
    (_label, content: Record<string, unknown>) => {
      const event = makeEvent('$root', undefined, undefined, undefined, {
        ts: NOW - 1_000,
        content,
      });

      expect(isZeroReplyStandaloneThreadRootEvent(event, NOW)).toBe(true);
    }
  );

  it('returns false for m.notice (silent/system messages)', () => {
    const noticeEvent = makeEvent('$notice', 'Notice body', undefined, undefined, {
      ts: NOW - 1_000,
      msgtype: 'm.notice',
    });
    expect(isZeroReplyStandaloneThreadRootEvent(noticeEvent, NOW)).toBe(false);
  });

  it('returns false for an m.replace edit relation', () => {
    const editEvent = makeEvent(
      '$edit',
      '* edited',
      undefined,
      { event_id: '$target', rel_type: 'm.replace' },
      { ts: NOW - 1_000 }
    );
    expect(isZeroReplyStandaloneThreadRootEvent(editEvent, NOW)).toBe(false);
  });

  it('returns false for a redacted event', () => {
    const redacted = makeEvent('$redacted', 'gone', undefined, undefined, {
      ts: NOW - 1_000,
      isRedacted: true,
    });
    expect(isZeroReplyStandaloneThreadRootEvent(redacted, NOW)).toBe(false);
  });

  it('returns false for a nested thread reply', () => {
    const nestedReply = makeEvent(
      '$nested-reply',
      'Nested reply body',
      undefined,
      {
        event_id: '$parent-root',
        rel_type: 'm.thread',
        'm.in_reply_to': { event_id: '$parent-reply' },
      },
      { ts: NOW - 1_000, threadRootId: '$parent-root' }
    );
    expect(isZeroReplyStandaloneThreadRootEvent(nestedReply, NOW)).toBe(false);
  });
});
