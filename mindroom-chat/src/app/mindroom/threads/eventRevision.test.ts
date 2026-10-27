import { MatrixEvent, type IEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  collectEmbeddedRelationEventIds,
  collectExplicitRedactedEventIds,
  describeMatrixEventRevision,
  describeRawEventRevision,
  hasEventRevisionUpgrade,
  mergeRawEventRevisions,
  stripRedactedRelationsFromRawEvent,
} from './eventRevision';

const baseEvent = (unsigned?: Partial<IEvent>['unsigned']): Partial<IEvent> => ({
  event_id: '$event',
  sender: '@alice:example.org',
  origin_server_ts: 1,
  type: 'm.room.message',
  content: { body: 'message' },
  ...(unsigned ? { unsigned } : {}),
});

describe('event aggregation revisions', () => {
  it('does not synthesize empty unsigned data for plain same-id observations', () => {
    const current = baseEvent();
    const incoming = { ...baseEvent(), origin_server_ts: 2, content: { body: 'newer' } };

    expect(mergeRawEventRevisions(current, incoming)).toEqual(incoming);
    expect(mergeRawEventRevisions(current, incoming)).not.toHaveProperty('unsigned');
  });

  it('treats reordered annotation buckets as the same semantic snapshot', () => {
    const left = baseEvent({
      'm.relations': {
        'm.annotation': {
          chunk: [
            { type: 'm.reaction', key: 'a', count: 1 },
            { type: 'm.reaction', key: 'b', count: 2 },
          ],
        },
      },
    });
    const right = baseEvent({
      'm.relations': {
        'm.annotation': {
          chunk: [
            { type: 'm.reaction', key: 'b', count: 2 },
            { type: 'm.reaction', key: 'a', count: 1 },
          ],
        },
      },
    });

    const leftRevision = describeRawEventRevision(left);
    const rightRevision = describeRawEventRevision(right);
    expect(hasEventRevisionUpgrade(leftRevision, leftRevision)).toBe(false);
    expect(hasEventRevisionUpgrade(rightRevision, leftRevision)).toBe(false);
    expect(hasEventRevisionUpgrade(leftRevision, rightRevision)).toBe(false);
  });

  it('advances partial thread counts without accepting stale count downgrades', () => {
    const withThreadCount = (count: number) =>
      baseEvent({
        'm.relations': {
          'm.thread': { count, current_user_participated: count >= 5 },
        },
      });

    const upgraded = mergeRawEventRevisions(withThreadCount(2), withThreadCount(5));
    const replayedStale = mergeRawEventRevisions(upgraded, withThreadCount(2));
    const threadBundle = replayedStale.unsigned?.['m.relations']?.['m.thread'];

    expect(threadBundle).toEqual({ count: 5, current_user_participated: true });
    expect(
      hasEventRevisionUpgrade(
        describeRawEventRevision(withThreadCount(2)),
        describeRawEventRevision(upgraded)
      )
    ).toBe(false);
    expect(
      hasEventRevisionUpgrade(
        describeRawEventRevision(withThreadCount(6)),
        describeRawEventRevision(upgraded)
      )
    ).toBe(true);
  });

  it('still detects authoritative aggregation decreases and removals', () => {
    const current = describeRawEventRevision(
      baseEvent({ 'm.relations': { 'm.thread': { count: 5 } } })
    );
    const lowerCount = describeRawEventRevision(
      baseEvent({ 'm.relations': { 'm.thread': { count: 3 } } })
    );
    const removedBundle = describeRawEventRevision(baseEvent({}));

    expect(hasEventRevisionUpgrade(lowerCount, current)).toBe(false);
    expect(hasEventRevisionUpgrade(lowerCount, current, 'authoritative')).toBe(true);
    expect(hasEventRevisionUpgrade(removedBundle, current, 'authoritative')).toBe(true);
  });

  it('moves partial thread latest_event forward while keeping the maximum observed count', () => {
    const withThread = (count: number, latestId: string, latestTs: number) =>
      baseEvent({
        'm.relations': {
          'm.thread': {
            count,
            latest_event: {
              event_id: latestId,
              sender: '@alice:example.org',
              origin_server_ts: latestTs,
              type: 'm.room.message',
              content: { body: latestId, msgtype: 'm.text' },
            },
          },
        },
      });

    const merged = mergeRawEventRevisions(
      withThread(5, '$reply-old', 100),
      withThread(4, '$reply-new', 200)
    );
    expect(merged.unsigned?.['m.relations']?.['m.thread']).toMatchObject({
      count: 5,
      latest_event: { event_id: '$reply-new', origin_server_ts: 200 },
    });
  });

  it('advances relation evidence independently of a stale edit without repeated divergence', () => {
    const withEditAndCount = (editId: string, editTs: number, count: number) =>
      baseEvent({
        'm.relations': {
          'm.replace': {
            event_id: editId,
            sender: '@alice:example.org',
            origin_server_ts: editTs,
            type: 'm.room.message',
            content: {
              'm.new_content': { body: editId },
              'm.relates_to': { rel_type: 'm.replace', event_id: '$event' },
            },
          },
          'm.thread': { count },
        },
      });
    const current = withEditAndCount('$edit-v3', 300, 2);
    const staleEditWithNewCount = withEditAndCount('$edit-v2', 200, 5);

    expect(
      hasEventRevisionUpgrade(
        describeRawEventRevision(staleEditWithNewCount),
        describeRawEventRevision(current)
      )
    ).toBe(true);
    const merged = mergeRawEventRevisions(current, staleEditWithNewCount);
    expect(merged.unsigned?.['m.relations']).toMatchObject({
      'm.replace': { event_id: '$edit-v3' },
      'm.thread': { count: 5 },
    });
    expect(
      hasEventRevisionUpgrade(
        describeRawEventRevision(staleEditWithNewCount),
        describeRawEventRevision(merged)
      )
    ).toBe(false);
  });

  it('merges partial annotation buckets per key with monotonic counts', () => {
    const withAnnotations = (chunk: Array<Record<string, unknown>>) =>
      baseEvent({ 'm.relations': { 'm.annotation': { chunk } } });
    const current = withAnnotations([{ type: 'm.reaction', key: '👍', count: 2, me: true }]);
    const upgraded = mergeRawEventRevisions(
      current,
      withAnnotations([
        { type: 'm.reaction', key: '👍', count: 5 },
        { type: 'm.reaction', key: '❤️', count: 1 },
      ])
    );
    const replayedStale = mergeRawEventRevisions(
      upgraded,
      withAnnotations([{ type: 'm.reaction', key: '👍', count: 2 }])
    );
    const annotation = replayedStale.unsigned?.['m.relations']?.['m.annotation'] as {
      chunk?: Array<{ key?: string; count?: number; me?: boolean }>;
    };

    expect(annotation.chunk).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: '👍', count: 5, me: true }),
        expect.objectContaining({ key: '❤️', count: 1 }),
      ])
    );
  });

  it('keeps opaque partial bundles stable while authoritative snapshots preserve their order', () => {
    const left = baseEvent({
      'm.relations': {
        'com.example.ordered': { chunk: ['first', 'second'] },
      },
    });
    const right = baseEvent({
      'm.relations': {
        'com.example.ordered': { chunk: ['second', 'first'] },
      },
    });

    expect(
      hasEventRevisionUpgrade(describeRawEventRevision(right), describeRawEventRevision(left))
    ).toBe(false);
    expect(
      mergeRawEventRevisions(left, right, 'authoritative').unsigned?.['m.relations']?.[
        'com.example.ordered'
      ]
    ).toEqual({ chunk: ['second', 'first'] });
  });

  it('does not report a stale replacement as divergence after redaction', () => {
    const redacted = baseEvent({
      redacted_because: {
        event_id: '$redaction',
        sender: '@mod:example.org',
        origin_server_ts: 3,
        type: 'm.room.redaction',
        content: {},
      } as IEvent,
    });
    const stale = baseEvent({
      'm.relations': {
        'm.replace': {
          event_id: '$edit',
          sender: '@alice:example.org',
          origin_server_ts: 2,
          type: 'm.room.message',
          content: {},
        },
      },
    });

    expect(
      hasEventRevisionUpgrade(describeRawEventRevision(stale), describeRawEventRevision(redacted))
    ).toBe(false);
  });

  it('lets unrelated authoritative bundles advance on a redacted target', () => {
    const redacted = baseEvent({
      redacted_because: {
        event_id: '$redaction',
        sender: '@mod:example.org',
        origin_server_ts: 3,
        type: 'm.room.redaction',
        content: {},
      } as IEvent,
    });
    const fetched = baseEvent({
      'm.relations': {
        'm.replace': {
          event_id: '$stale-edit',
          sender: '@alice:example.org',
          origin_server_ts: 2,
        },
        'm.thread': { count: 4, current_user_participated: false },
      },
    });

    expect(
      hasEventRevisionUpgrade(describeRawEventRevision(fetched), describeRawEventRevision(redacted))
    ).toBe(true);
    const merged = mergeRawEventRevisions(redacted, fetched, 'authoritative');
    const relations = merged.unsigned?.['m.relations'] as Record<string, unknown> | undefined;
    expect(relations?.['m.replace']).toBeUndefined();
    expect(relations?.['m.thread']).toEqual({ count: 4, current_user_participated: false });
  });

  it('uses the same event-id tie break for raw and Matrix event replacements', () => {
    const edit = (eventId: string): Partial<IEvent> => ({
      event_id: eventId,
      sender: '@alice:example.org',
      origin_server_ts: 10,
      type: 'm.room.message',
      content: {
        body: eventId,
        'm.new_content': { body: eventId },
        'm.relates_to': { rel_type: 'm.replace', event_id: '$event' },
      },
    });
    const withEdit = (replacement: Partial<IEvent>) =>
      baseEvent({ 'm.relations': { 'm.replace': replacement } });
    const edit1 = edit('$edit-1');
    const edit2 = edit('$edit-2');

    expect(
      describeRawEventRevision(mergeRawEventRevisions(withEdit(edit1), withEdit(edit2)))
    ).toMatchObject({ replacement: { eventId: '$edit-2', ts: 10 } });
    expect(
      describeRawEventRevision(mergeRawEventRevisions(withEdit(edit2), withEdit(edit1)))
    ).toMatchObject({ replacement: { eventId: '$edit-2', ts: 10 } });

    const target = new MatrixEvent(withEdit(edit1) as IEvent);
    target.makeReplaced(new MatrixEvent(edit2 as IEvent));
    expect(describeMatrixEventRevision(target)).toMatchObject({
      replacement: { eventId: '$edit-2', ts: 10 },
    });
  });

  it('removes redacted edit references without discarding unrelated thread metadata', () => {
    const nestedEdit = {
      event_id: '$redacted-edit',
      sender: '@alice:example.org',
      origin_server_ts: 4,
      type: 'm.room.message',
      content: { body: 'secret' },
    } satisfies Partial<IEvent>;
    const rawEvent = baseEvent({
      'm.relations': {
        'm.replace': nestedEdit,
        'm.annotation': { chunk: [{ key: '👍', count: 1 }] },
        'm.thread': {
          count: 2,
          current_user_participated: true,
          latest_event: {
            ...baseEvent({ 'm.relations': { 'm.replace': nestedEdit } }),
            event_id: '$latest',
          },
        },
      },
    });

    const pruned = stripRedactedRelationsFromRawEvent(rawEvent, new Set(['$redacted-edit']));
    const relations = pruned.unsigned?.['m.relations'] as Record<string, any>;
    expect(relations['m.replace']).toBeUndefined();
    expect(relations['m.annotation']).toEqual({ chunk: [{ key: '👍', count: 1 }] });
    expect(relations['m.thread']).toMatchObject({
      count: 2,
      current_user_participated: true,
      latest_event: { event_id: '$latest' },
    });
    expect(
      relations['m.thread'].latest_event.unsigned?.['m.relations']?.['m.replace']
    ).toBeUndefined();
    expect(JSON.stringify(pruned)).not.toContain('secret');
  });

  it('removes a redacted bundled latest event and detects both redaction forms', () => {
    const rawEvent = baseEvent({
      'm.relations': {
        'm.thread': {
          count: 1,
          latest_event: { ...baseEvent(), event_id: '$redacted-latest' },
        },
      },
    });
    const redactedTarget = {
      ...baseEvent(),
      event_id: '$redacted-target',
      unsigned: { redacted_because: { event_id: '$redaction-a' } as IEvent },
    };
    const redaction = {
      ...baseEvent(),
      event_id: '$redaction-b',
      type: 'm.room.redaction',
      redacts: '$redacted-latest',
    };

    expect(collectExplicitRedactedEventIds([redactedTarget, redaction])).toEqual(
      new Set(['$redacted-target', '$redacted-latest'])
    );
    expect(collectEmbeddedRelationEventIds([rawEvent])).toEqual(new Set(['$redacted-latest']));
    const pruned = stripRedactedRelationsFromRawEvent(rawEvent, new Set(['$redacted-latest']));
    expect(
      (pruned.unsigned?.['m.relations'] as Record<string, any>)['m.thread'].latest_event
    ).toBeUndefined();
  });

  it('discovers redaction state inside bundled replacements and latest events', () => {
    const bundledReplacement = {
      event_id: '$bundled-edit',
      sender: '@alice:example.org',
      origin_server_ts: 3,
      type: 'm.room.message',
      content: { body: 'secret edit' },
      unsigned: { redacted_because: { event_id: '$redaction-edit' } as IEvent },
    } satisfies Partial<IEvent>;
    const latestEvent = {
      ...baseEvent(),
      event_id: '$bundled-latest',
      content: { body: 'secret latest' },
      unsigned: { redacted_because: { event_id: '$redaction-latest' } as IEvent },
    } satisfies Partial<IEvent>;
    const rawEvent = baseEvent({
      'm.relations': {
        'm.replace': bundledReplacement,
        'm.thread': { count: 1, latest_event: latestEvent },
      },
    });

    const redactedEventIds = collectExplicitRedactedEventIds([rawEvent]);
    expect(redactedEventIds).toEqual(new Set(['$bundled-edit', '$bundled-latest']));
    const pruned = stripRedactedRelationsFromRawEvent(rawEvent, redactedEventIds);
    expect(JSON.stringify(pruned)).not.toContain('secret edit');
    expect(JSON.stringify(pruned)).not.toContain('secret latest');
  });
});
