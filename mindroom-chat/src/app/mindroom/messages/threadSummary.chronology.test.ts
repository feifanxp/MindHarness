import { EventStatus, MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  buildThreadSummaryMap,
  getLatestThreadSummaryInfoFromEventSources,
  getThreadSummaryEventInfo,
  getMindroomThreadSummaryInfo,
  pickLatestThreadSummaryInfo,
} from './threadSummary';
import { resolveThreadSummaryInfo } from '../threads/threadPresentation';

const notice = (id: string, body: string, timestamp: number, generated: number) =>
  new MatrixEvent({
    event_id: id,
    type: 'm.room.message',
    origin_server_ts: timestamp,
    content: {
      msgtype: 'm.notice',
      body,
      'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
      'io.mindroom.thread_summary': {
        version: 1,
        summary: body,
        generated_at: new Date(generated).toISOString(),
      },
    },
  });

describe('summary event chronology', () => {
  it('enriches legacy cache before choosing the newest live title on both surfaces', () => {
    const automatic = notice('$auto', 'Stale automatic', 1100, 9000);
    const manual = notice('$manual', 'Accepted human title', 1200, 1000);
    manual.event.content!['io.mindroom.thread_summary'].model = 'manual';
    const legacy = getMindroomThreadSummaryInfo(automatic.getContent());
    expect(
      resolveThreadSummaryInfo({
        preferredSummaryInfo: legacy,
        thread: {
          events: [automatic, manual],
          timeline: [automatic, manual],
          replyToEvent: manual,
        },
      })?.summaryText
    ).toBe('Accepted human title');
    const candidates = [
      legacy,
      getThreadSummaryEventInfo(automatic),
      getThreadSummaryEventInfo(manual),
    ];
    for (const order of [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ]) {
      expect(
        pickLatestThreadSummaryInfo(...order.map((index) => candidates[index]))?.summaryText
      ).toBe('Accepted human title');
    }
  });

  it('uses server order across live and cached sources despite sender clock skew', () => {
    const automatic = notice('$auto', 'Automatic', 1100, 9000);
    const manual = notice('$manual', 'Human title', 1200, 1000);
    manual.event.content!['io.mindroom.thread_summary'].model = 'manual';
    const regenerated = notice('$regenerated', 'Explicit regeneration', 1300, 2000);
    const cached = getThreadSummaryEventInfo(manual);
    expect(
      pickLatestThreadSummaryInfo(cached, getThreadSummaryEventInfo(automatic))?.summaryText
    ).toBe('Human title');
    expect(getLatestThreadSummaryInfoFromEventSources([manual], [automatic])?.summaryText).toBe(
      'Human title'
    );
    expect(
      pickLatestThreadSummaryInfo(cached, getThreadSummaryEventInfo(regenerated))?.summaryText
    ).toBe('Explicit regeneration');
  });

  it('orders a replaced notice by its accepted edit across every event collection', () => {
    const original = notice('$original', 'Original', 1000, 9000);
    const edit = notice('$edit', 'Edited title', 1400, 1000);
    edit.event.content = {
      ...edit.getContent(),
      'm.new_content': edit.getContent(),
      'm.relates_to': { rel_type: 'm.replace', event_id: '$original' },
    };
    original.makeReplaced(edit);
    const newerOriginal = notice('$other', 'Older decision', 1200, 2000);
    expect(getLatestThreadSummaryInfoFromEventSources([original, newerOriginal])?.summaryText).toBe(
      'Edited title'
    );
    expect(buildThreadSummaryMap([original, newerOriginal]).get('$root')?.summaryText).toBe(
      'Edited title'
    );
  });

  it('does not treat a sent local echo timestamp as server acceptance time', () => {
    const local = notice('$accepted', 'Human title', 9000, 1000);
    local.setStatus(EventStatus.SENT);
    const remote = notice('$accepted', 'Human title', 1200, 1000);
    const regenerated = notice('$regenerated', 'Later update', 1300, 2000);
    const hydrated = pickLatestThreadSummaryInfo(
      getThreadSummaryEventInfo(local),
      getThreadSummaryEventInfo(remote)
    );
    expect(hydrated).toMatchObject({ eventTs: 1200 });
    expect(
      pickLatestThreadSummaryInfo(hydrated, getThreadSummaryEventInfo(regenerated))?.summaryText
    ).toBe('Later update');
  });
});
