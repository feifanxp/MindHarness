import { IEventWithRoomId, IResultContext, ISearchResult } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { deduplicateResults } from './useMessageSearch';

type SearchResultOptions = {
  eventId: string;
  roomId?: string;
  ts: number;
  editTargetId?: string;
  content?: Record<string, unknown>;
  sender?: string;
};

const makeSearchResult = ({
  eventId,
  roomId = '!room:example.org',
  ts,
  editTargetId,
  content,
  sender = '@alice:example.org',
}: SearchResultOptions): ISearchResult =>
  ({
    rank: ts,
    result: {
      content: content ?? {
        ...(editTargetId
          ? {
              'm.new_content': {
                body: `${eventId} body`,
                msgtype: 'm.text',
              },
              'm.relates_to': {
                event_id: editTargetId,
                rel_type: 'm.replace',
              },
            }
          : {}),
        body: `${eventId} body`,
        msgtype: 'm.text',
      },
      event_id: eventId,
      origin_server_ts: ts,
      room_id: roomId,
      sender,
      type: 'm.room.message',
    } as IEventWithRoomId,
    context: {} as IResultContext,
  } as ISearchResult);

const getEventIds = (results: ISearchResult[]): string[] =>
  results.map((result) => result.result.event_id);

describe('deduplicateResults', () => {
  it('passes through results without edits', () => {
    const results = [
      makeSearchResult({ eventId: '$one', ts: 100 }),
      makeSearchResult({ eventId: '$two', ts: 200 }),
    ];

    expect(getEventIds(deduplicateResults(results))).toEqual(['$one', '$two']);
  });

  it('keeps the edit instead of the original when both match', () => {
    const results = [
      makeSearchResult({ eventId: '$original', ts: 100 }),
      makeSearchResult({ eventId: '$edit', ts: 200, editTargetId: '$original' }),
    ];

    expect(getEventIds(deduplicateResults(results))).toEqual(['$edit']);
  });

  it('keeps only the latest edit when multiple edits match the same message', () => {
    const results = [
      makeSearchResult({ eventId: '$original', ts: 100 }),
      makeSearchResult({ eventId: '$edit-1', ts: 200, editTargetId: '$original' }),
      makeSearchResult({ eventId: '$edit-2', ts: 300, editTargetId: '$original' }),
      makeSearchResult({ eventId: '$edit-3', ts: 400, editTargetId: '$original' }),
    ];

    expect(getEventIds(deduplicateResults(results))).toEqual(['$edit-3']);
  });

  it('merges an edit into the original only when the same sender sent both', () => {
    const original = makeSearchResult({ eventId: '$original', ts: 100 });
    const otherSenderEdit = makeSearchResult({
      eventId: '$other-sender-edit',
      ts: 200,
      editTargetId: '$original',
      sender: '@bob:example.org',
    });
    const ownEdit = makeSearchResult({ eventId: '$own-edit', ts: 300, editTargetId: '$original' });

    expect(getEventIds(deduplicateResults([original, otherSenderEdit]))).toEqual([
      '$original',
      '$other-sender-edit',
    ]);
    expect(getEventIds(deduplicateResults([original, otherSenderEdit, ownEdit]))).toEqual([
      '$other-sender-edit',
      '$own-edit',
    ]);
  });

  it('keeps an edit-only match when the original is not present', () => {
    const results = [makeSearchResult({ eventId: '$edit', ts: 200, editTargetId: '$original' })];

    expect(getEventIds(deduplicateResults(results))).toEqual(['$edit']);
  });

  it('does not collapse results from different rooms', () => {
    const results = [
      makeSearchResult({ eventId: '$shared', roomId: '!one:example.org', ts: 100 }),
      makeSearchResult({ eventId: '$shared', roomId: '!two:example.org', ts: 200 }),
    ];

    expect(getEventIds(deduplicateResults(results))).toEqual(['$shared', '$shared']);
    expect(deduplicateResults(results).map((result) => result.result.room_id)).toEqual([
      '!one:example.org',
      '!two:example.org',
    ]);
  });

  it('does not collapse a redacted edit with the original', () => {
    const results = [
      makeSearchResult({ eventId: '$original', ts: 100 }),
      makeSearchResult({
        eventId: '$redacted-edit',
        ts: 200,
        content: {},
      }),
    ];

    expect(getEventIds(deduplicateResults(results))).toEqual(['$original', '$redacted-edit']);
  });

  it('preserves server ordering after removing losing duplicates', () => {
    const results = [
      makeSearchResult({ eventId: '$original', ts: 100 }),
      makeSearchResult({ eventId: '$other', roomId: '!two:example.org', ts: 150 }),
      makeSearchResult({ eventId: '$edit', ts: 200, editTargetId: '$original' }),
      makeSearchResult({ eventId: '$last', roomId: '!three:example.org', ts: 250 }),
    ];

    expect(getEventIds(deduplicateResults(results))).toEqual(['$other', '$edit', '$last']);
  });
});
