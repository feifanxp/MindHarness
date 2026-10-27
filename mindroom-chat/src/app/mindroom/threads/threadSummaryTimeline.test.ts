import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { planThreadSummaryTimeline } from './threadSummaryTimeline';

const summary = (id: string, text: string, messageCount = 1) =>
  new MatrixEvent({
    type: 'm.room.message',
    event_id: id,
    room_id: '!room:example.org',
    sender: '@code:example.org',
    content: {
      msgtype: 'm.notice',
      body: text,
      'io.mindroom.thread_summary': { version: 1, summary: text, message_count: messageCount },
    },
  });
const reply = (id: string) =>
  new MatrixEvent({
    type: 'm.room.message',
    event_id: id,
    room_id: '!room:example.org',
    sender: '@code:example.org',
    content: { msgtype: 'm.text', body: id },
  });

const startLoaded = { sdkLoaded: true, canPaginateBack: false, hasMoreCachedBack: false };

describe('thread summary timeline plan', () => {
  it('marks the first summary of a fully loaded thread as its first title', () => {
    const plan = planThreadSummaryTimeline([reply('$root'), summary('$s1', 'Push bug')], {
      history: startLoaded,
    });

    expect(plan.hiddenEventIds.size).toBe(0);
    expect(plan.markersByEventId.get('$s1')).toEqual({ first: true });
  });

  it('hides a summary that repeats the one before it', () => {
    const plan = planThreadSummaryTimeline(
      [summary('$s1', 'Push bug'), reply('$r1'), summary('$s2', 'Push bug', 11)],
      { history: startLoaded }
    );

    expect([...plan.hiddenEventIds]).toEqual(['$s2']);
    expect(plan.markersByEventId.has('$s2')).toBe(false);
  });

  it('ignores surrounding whitespace when comparing summaries', () => {
    const plan = planThreadSummaryTimeline(
      [summary('$s1', 'Push bug'), summary('$s2', '  Push bug\n')],
      { history: startLoaded }
    );

    expect([...plan.hiddenEventIds]).toEqual(['$s2']);
  });

  it('gives a changed summary the text it replaces', () => {
    const plan = planThreadSummaryTimeline(
      [
        summary('$s1', 'Push bug'),
        summary('$s2', 'Push bug', 11),
        reply('$r1'),
        summary('$s3', 'Fixing token refresh', 21),
      ],
      { history: startLoaded }
    );

    expect(plan.markersByEventId.get('$s3')).toEqual({
      first: false,
      previousSummaryText: 'Push bug',
    });
  });

  it('compares the text a summary row shows, after its latest edit', () => {
    const edited = summary('$s2', 'Push bug', 11);
    const plan = planThreadSummaryTimeline([summary('$s1', 'Push bug'), edited], {
      history: startLoaded,
      getContent: (event) =>
        event === edited
          ? {
              ...event.getContent(),
              body: 'Token refresh',
              'io.mindroom.thread_summary': { version: 1, summary: 'Token refresh' },
            }
          : event.getContent(),
    });

    expect(plan.hiddenEventIds.size).toBe(0);
    expect(plan.markersByEventId.get('$s2')).toEqual({
      first: false,
      previousSummaryText: 'Push bug',
    });
  });

  it('ignores summaries from ignored users, whose rows are hidden', () => {
    const fromIgnored = new MatrixEvent({
      type: 'm.room.message',
      event_id: '$ignored',
      room_id: '!room:example.org',
      sender: '@spam:example.org',
      content: {
        msgtype: 'm.notice',
        body: 'Token refresh',
        'io.mindroom.thread_summary': { version: 1, summary: 'Token refresh' },
      },
    });
    const plan = planThreadSummaryTimeline(
      [summary('$s1', 'Push bug'), fromIgnored, summary('$s2', 'Token refresh', 11)],
      { history: startLoaded, ignoredUserIds: new Set(['@spam:example.org']) }
    );

    expect(plan.markersByEventId.has('$ignored')).toBe(false);
    expect(plan.markersByEventId.get('$s2')).toEqual({
      first: false,
      previousSummaryText: 'Push bug',
    });
  });

  it('ignores summary edits, which have no row of their own', () => {
    const edit = new MatrixEvent({
      type: 'm.room.message',
      event_id: '$edit',
      room_id: '!room:example.org',
      sender: '@code:example.org',
      content: {
        msgtype: 'm.notice',
        body: '* Token refresh',
        'io.mindroom.thread_summary': { version: 1, summary: 'Token refresh', message_count: 1 },
        'm.new_content': { msgtype: 'm.notice', body: 'Token refresh' },
        'm.relates_to': { rel_type: 'm.replace', event_id: '$s1' },
      },
    });
    const plan = planThreadSummaryTimeline(
      [
        summary('$s1', 'Push bug'),
        summary('$s2', 'APNs logs'),
        edit,
        summary('$s3', 'Token refresh'),
      ],
      { history: startLoaded }
    );

    expect(plan.hiddenEventIds.size).toBe(0);
    expect(plan.markersByEventId.has('$edit')).toBe(false);
    expect(plan.markersByEventId.get('$s3')).toEqual({
      first: false,
      previousSummaryText: 'APNs logs',
    });
  });

  it('does not call the earliest loaded summary the first while older history is missing', () => {
    const plan = planThreadSummaryTimeline([reply('$r9'), summary('$s2', 'Push bug', 11)], {
      history: { ...startLoaded, canPaginateBack: true },
    });

    expect(plan.markersByEventId.get('$s2')).toEqual({ first: false });
  });

  it('does not call the earliest loaded summary the first while the cache holds older history', () => {
    const plan = planThreadSummaryTimeline([summary('$s2', 'Push bug', 11)], {
      history: { ...startLoaded, hasMoreCachedBack: true },
    });

    expect(plan.markersByEventId.get('$s2')).toEqual({ first: false });
  });

  it('does not call the earliest loaded summary the first before the thread has loaded', () => {
    const plan = planThreadSummaryTimeline([summary('$s2', 'Push bug', 11)], {
      history: { ...startLoaded, sdkLoaded: false },
    });

    expect(plan.markersByEventId.get('$s2')).toEqual({ first: false });
  });

  it('keeps a repeated summary visible when it is the event being opened', () => {
    const plan = planThreadSummaryTimeline(
      [summary('$s1', 'Push bug'), summary('$s2', 'Push bug', 11)],
      { history: startLoaded, revealedEventIds: new Set(['$s2']) }
    );

    expect(plan.hiddenEventIds.size).toBe(0);
    expect(plan.markersByEventId.get('$s2')).toEqual({ first: false });
  });
});
