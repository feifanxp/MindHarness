import { describe, expect, it } from 'vitest';
import {
  isMindroomThreadSummaryEvent,
  findLatestThreadSummaryEvent,
  getLatestThreadSummaryInfo,
  getLatestThreadSummaryInfoFromEventSources,
  getThreadSummaryPreviewText,
  buildThreadSummaryMap,
  hasMindroomThreadSummary,
  pickLatestThreadSummaryInfo,
} from './threadSummary';

const makeEvent = (content: Record<string, unknown>) => ({
  getContent: () => content,
  getType: () => 'm.room.message',
  getId: () => undefined as string | undefined,
  threadRootId: undefined as string | undefined,
});

const makeSummaryEvent = (body: string, extra?: Record<string, unknown>) =>
  makeEvent({
    msgtype: 'm.notice',
    body,
    'io.mindroom.thread_summary': true,
    ...extra,
  });

describe('confirmed summary selection', () => {
  it.each(['sending', 'not_sent', 'queued', 'encrypting', 'cancelled'])(
    'keeps the saved summary while the replacement is %s',
    (status) => {
      expect(
        getLatestThreadSummaryInfo([
          makeSummaryEvent('Saved summary'),
          { ...makeSummaryEvent('Unsent summary'), status },
        ])?.summaryText
      ).toBe('Saved summary');
    }
  );
});

const makeThreadEvent = (id: string, threadRootId: string, content: Record<string, unknown>) => ({
  ...makeEvent(content),
  getId: () => id,
  threadRootId,
});

describe('isMindroomThreadSummaryEvent', () => {
  it('returns true for m.notice with thread_summary metadata', () => {
    expect(isMindroomThreadSummaryEvent(makeSummaryEvent('Summary text'))).toBe(true);
  });

  it('returns false for m.text messages', () => {
    expect(
      isMindroomThreadSummaryEvent(
        makeEvent({ msgtype: 'm.text', body: 'hi', 'io.mindroom.thread_summary': true })
      )
    ).toBe(false);
  });

  it('returns false when thread_summary metadata is absent', () => {
    expect(isMindroomThreadSummaryEvent(makeEvent({ msgtype: 'm.notice', body: 'hi' }))).toBe(
      false
    );
  });

  it('returns false for empty content', () => {
    expect(isMindroomThreadSummaryEvent(makeEvent({}))).toBe(false);
  });
});

describe('findLatestThreadSummaryEvent', () => {
  it('returns the last summary event in an array', () => {
    const events = [
      makeEvent({ msgtype: 'm.text', body: 'user msg' }),
      makeSummaryEvent('First summary'),
      makeEvent({ msgtype: 'm.text', body: 'another msg' }),
      makeSummaryEvent('Latest summary'),
      makeEvent({ msgtype: 'm.text', body: 'final msg' }),
    ];
    const result = findLatestThreadSummaryEvent(events);
    expect(result).toBe(events[3]);
    expect(getThreadSummaryPreviewText(result!)).toBe('Latest summary');
  });

  it('returns undefined when no summary events exist', () => {
    const events = [
      makeEvent({ msgtype: 'm.text', body: 'user msg' }),
      makeEvent({ msgtype: 'm.notice', body: 'regular notice' }),
    ];
    expect(findLatestThreadSummaryEvent(events)).toBeUndefined();
  });

  it('returns undefined for empty array', () => {
    expect(findLatestThreadSummaryEvent([])).toBeUndefined();
  });
});

describe('hasMindroomThreadSummary', () => {
  it('returns true for versioned thread summary metadata objects', () => {
    expect(
      hasMindroomThreadSummary({
        msgtype: 'm.notice',
        body: 'Summary body',
        'io.mindroom.thread_summary': {
          version: 1,
          summary: 'Summary body',
        },
      })
    ).toBe(true);
  });

  it('returns true when edited m.new_content carries the versioned metadata', () => {
    expect(
      hasMindroomThreadSummary({
        msgtype: 'm.notice',
        body: 'Original body',
        'm.new_content': {
          msgtype: 'm.notice',
          body: 'Edited body',
          'io.mindroom.thread_summary': {
            version: 1,
            summary: 'Edited body',
          },
        },
      })
    ).toBe(true);
  });

  it('returns true for legacy boolean thread summary flags', () => {
    expect(
      hasMindroomThreadSummary({
        msgtype: 'm.notice',
        body: 'Legacy summary body',
        'io.mindroom.thread_summary': true,
      })
    ).toBe(true);
  });
});

describe('getThreadSummaryPreviewText', () => {
  it('extracts body from summary event', () => {
    expect(getThreadSummaryPreviewText(makeSummaryEvent('Hello world'))).toBe('Hello world');
  });

  it('prefers m.new_content body for edited summaries', () => {
    const event = makeSummaryEvent('Original body', {
      'm.new_content': { body: 'Edited body', msgtype: 'm.notice' },
    });
    expect(getThreadSummaryPreviewText(event)).toBe('Edited body');
  });

  it('falls back to top-level body when m.new_content has no body', () => {
    const event = makeSummaryEvent('Fallback body', {
      'm.new_content': { msgtype: 'm.notice' },
    });
    expect(getThreadSummaryPreviewText(event)).toBe('Fallback body');
  });

  it('returns undefined for empty body', () => {
    const event = makeEvent({
      msgtype: 'm.notice',
      body: '',
      'io.mindroom.thread_summary': true,
    });
    expect(getThreadSummaryPreviewText(event)).toBeUndefined();
  });

  it('returns undefined when body is not a string', () => {
    const event = makeEvent({
      msgtype: 'm.notice',
      body: 42,
      'io.mindroom.thread_summary': true,
    });
    expect(getThreadSummaryPreviewText(event)).toBeUndefined();
  });
});

describe('buildThreadSummaryMap', () => {
  it('maps thread root IDs to their latest summary text', () => {
    const events = [
      makeThreadEvent('evt-1', 'root-1', {
        msgtype: 'm.notice',
        body: 'Old summary',
        'io.mindroom.thread_summary': true,
      }),
      makeThreadEvent('evt-2', 'root-1', { msgtype: 'm.text', body: 'user reply' }),
      makeThreadEvent('evt-3', 'root-1', {
        msgtype: 'm.notice',
        body: 'Latest summary',
        'io.mindroom.thread_summary': true,
      }),
    ];
    const map = buildThreadSummaryMap(events);
    expect(map.get('root-1')?.summaryText).toBe('Latest summary');
    expect(map.size).toBe(1);
  });

  it('handles multiple threads independently', () => {
    const events = [
      makeThreadEvent('evt-1', 'root-1', {
        msgtype: 'm.notice',
        body: 'Summary for thread 1',
        'io.mindroom.thread_summary': true,
      }),
      makeThreadEvent('evt-2', 'root-2', {
        msgtype: 'm.notice',
        body: 'Summary for thread 2',
        'io.mindroom.thread_summary': true,
      }),
    ];
    const map = buildThreadSummaryMap(events);
    expect(map.get('root-1')?.summaryText).toBe('Summary for thread 1');
    expect(map.get('root-2')?.summaryText).toBe('Summary for thread 2');
  });

  it('skips thread root events (eventId === threadRootId)', () => {
    const events = [
      makeThreadEvent('root-1', 'root-1', {
        msgtype: 'm.notice',
        body: 'Should be skipped',
        'io.mindroom.thread_summary': true,
      }),
    ];
    const map = buildThreadSummaryMap(events);
    expect(map.size).toBe(0);
  });

  it('returns empty map when no summary events', () => {
    const events = [makeThreadEvent('evt-1', 'root-1', { msgtype: 'm.text', body: 'hello' })];
    const map = buildThreadSummaryMap(events);
    expect(map.size).toBe(0);
  });

  it('uses m.new_content for edited summaries', () => {
    const events = [
      makeThreadEvent('evt-1', 'root-1', {
        msgtype: 'm.notice',
        body: 'Original',
        'io.mindroom.thread_summary': true,
        'm.new_content': { body: 'Edited summary', msgtype: 'm.notice' },
      }),
    ];
    const map = buildThreadSummaryMap(events);
    expect(map.get('root-1')?.summaryText).toBe('Edited summary');
  });
});

describe('getLatestThreadSummaryInfo', () => {
  it('returns info for the latest summary event in an array', () => {
    const events = [
      makeSummaryEvent('Old summary', {
        'io.mindroom.thread_summary': {
          version: 1,
          summary: 'Old summary',
          generated_at: '2026-03-28T10:00:00.000Z',
        },
      }),
      makeEvent({ msgtype: 'm.text', body: 'Regular reply' }),
      makeSummaryEvent('Latest summary', {
        'io.mindroom.thread_summary': {
          version: 1,
          summary: 'Latest summary',
          generated_at: '2026-03-28T10:05:00.000Z',
          message_count: 12,
        },
      }),
    ];

    expect(getLatestThreadSummaryInfo(events)).toEqual({
      summaryText: 'Latest summary',
      generatedTs: Date.parse('2026-03-28T10:05:00.000Z'),
      messageCount: 12,
    });
  });

  it('returns undefined when no summary event exists', () => {
    expect(getLatestThreadSummaryInfo([makeEvent({ msgtype: 'm.text', body: 'Hello' })])).toBe(
      undefined
    );
  });
});

describe('getLatestThreadSummaryInfoFromEventSources', () => {
  it('prefers the newer summary when sources disagree', () => {
    const olderSource = [
      makeSummaryEvent('One-line thread summary', {
        'io.mindroom.thread_summary': {
          version: 1,
          summary: 'One-line thread summary',
          generated_at: '2026-04-09T19:40:00.000Z',
          message_count: 144,
        },
      }),
    ];
    const newerSource = [
      makeSummaryEvent('## Summary\n\nLong summary', {
        'io.mindroom.thread_summary': {
          version: 1,
          summary: '## Summary\n\nLong summary',
          generated_at: '2026-04-09T20:40:00.000Z',
          message_count: 151,
        },
      }),
    ];

    expect(getLatestThreadSummaryInfoFromEventSources(olderSource, newerSource)).toEqual({
      summaryText: '## Summary\n\nLong summary',
      generatedTs: Date.parse('2026-04-09T20:40:00.000Z'),
      messageCount: 151,
    });
  });
});

describe('pickLatestThreadSummaryInfo', () => {
  it('ignores summary dates outside the backend wire range in either candidate order', () => {
    const invalid = {
      summaryText: 'Unsupported date',
      generatedTs: Date.parse('+275760-09-13T00:00:00.000Z'),
      messageCount: 99,
    };
    const valid = { summaryText: 'Accepted replacement', generatedTs: 1000 };
    expect(pickLatestThreadSummaryInfo(invalid, valid)).toEqual(valid);
    expect(pickLatestThreadSummaryInfo(valid, invalid)).toEqual(valid);
    expect(pickLatestThreadSummaryInfo(invalid)).toBeUndefined();
  });

  it.each([undefined, 99])(
    'keeps a dated manual edit ahead of legacy summaries with count %s',
    (messageCount) => {
      const legacy = { summaryText: 'Old legacy summary', messageCount };
      const manual = { summaryText: 'Human replacement', isManual: true, generatedTs: 1000 };
      expect(pickLatestThreadSummaryInfo(legacy, manual)).toEqual(manual);
      expect(pickLatestThreadSummaryInfo(manual, legacy)).toEqual(manual);
    }
  );

  it.each([
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ])(
    'keeps the newer agent summary across mixed legacy/manual source order %s/%s/%s',
    (first, second, third) => {
      const sources = [
        { summaryText: 'New agent summary', generatedTs: 200 },
        { summaryText: 'Legacy summary', messageCount: 99 },
        { summaryText: 'Older manual summary', generatedTs: 100, isManual: true },
      ];
      expect(pickLatestThreadSummaryInfo(sources[first], sources[second], sources[third])).toEqual({
        summaryText: 'New agent summary',
        generatedTs: 200,
      });
    }
  );

  it('prefers the summary with the newer generated timestamp', () => {
    expect(
      pickLatestThreadSummaryInfo(
        { summaryText: 'Old summary', generatedTs: 100, messageCount: 4 },
        { summaryText: 'Latest summary', generatedTs: 200, messageCount: 3 }
      )
    ).toEqual({ summaryText: 'Latest summary', generatedTs: 200, messageCount: 3 });
  });

  it('falls back to the larger message count when timestamps are unavailable', () => {
    expect(
      pickLatestThreadSummaryInfo(
        { summaryText: 'Smaller count', messageCount: 7 },
        { summaryText: 'Bigger count', messageCount: 12 }
      )
    ).toEqual({ summaryText: 'Bigger count', messageCount: 12 });
  });

  it('prefers the later summary text when recency metadata ties', () => {
    expect(
      pickLatestThreadSummaryInfo(
        { summaryText: 'Keep me', generatedTs: 100, messageCount: 10 },
        {
          summaryText: 'Updated text',
          generatedTs: 100,
          messageCount: 10,
        }
      )
    ).toEqual({ summaryText: 'Updated text', generatedTs: 100, messageCount: 10 });
  });

  it('does not let timestamp presence alone beat a higher message count', () => {
    expect(
      pickLatestThreadSummaryInfo(
        { summaryText: 'Cached summary', messageCount: 12 },
        {
          summaryText: 'Older room summary',
          generatedTs: 100,
          messageCount: 10,
        }
      )
    ).toEqual({ summaryText: 'Cached summary', messageCount: 12 });
  });
});
