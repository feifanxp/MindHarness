import { describe, expect, it } from 'vitest';
import {
  buildPreferredThreadSummaryMap,
  selectThreadSummaryUpdate,
} from './threadSummarySelection';

describe('buildPreferredThreadSummaryMap', () => {
  it('prefers the newer cached summary over an older loaded room summary', () => {
    const cachedSummaryMap = new Map([
      [
        '$root',
        {
          summaryText: 'Newer cached summary',
          generatedTs: Date.parse('2026-03-29T11:00:00.000Z'),
          messageCount: 12,
        },
      ],
    ]);
    const loadedSummaryMap = new Map([
      [
        '$root',
        {
          summaryText: 'Older loaded summary',
          generatedTs: Date.parse('2026-03-29T10:00:00.000Z'),
          messageCount: 10,
        },
      ],
    ]);

    expect(buildPreferredThreadSummaryMap(cachedSummaryMap, loadedSummaryMap)).toEqual(
      new Map([
        [
          '$root',
          {
            summaryText: 'Newer cached summary',
            generatedTs: Date.parse('2026-03-29T11:00:00.000Z'),
            messageCount: 12,
          },
        ],
      ])
    );
  });
});

describe('selectThreadSummaryUpdate', () => {
  it('refreshes manual provenance when an older cache has the same summary text and timestamp', () => {
    const cached = { summaryText: 'Summary', generatedTs: 1000 };
    const live = { ...cached, isManual: true };
    expect(selectThreadSummaryUpdate(cached, live)).toBe(live);
    expect(
      buildPreferredThreadSummaryMap(new Map([['$root', cached]]), new Map([['$root', live]])).get(
        '$root'
      )?.isManual
    ).toBeDefined();
  });
  it('does not overwrite a newer cached summary with an older loaded summary', () => {
    expect(
      selectThreadSummaryUpdate(
        {
          summaryText: 'Newer cached summary',
          generatedTs: Date.parse('2026-03-29T11:00:00.000Z'),
          messageCount: 12,
        },
        {
          summaryText: 'Older loaded summary',
          generatedTs: Date.parse('2026-03-29T10:00:00.000Z'),
          messageCount: 10,
        }
      )
    ).toBeUndefined();
  });

  it('writes when the loaded summary is newer than the cached summary', () => {
    expect(
      selectThreadSummaryUpdate(
        {
          summaryText: 'Older cached summary',
          generatedTs: Date.parse('2026-03-29T10:00:00.000Z'),
          messageCount: 10,
        },
        {
          summaryText: 'Newer loaded summary',
          generatedTs: Date.parse('2026-03-29T11:00:00.000Z'),
          messageCount: 12,
        }
      )
    ).toBeDefined();
  });

  it('writes when the loaded summary text changes but recency metadata ties', () => {
    expect(
      selectThreadSummaryUpdate(
        {
          summaryText: 'Stale cached text',
          generatedTs: Date.parse('2026-03-29T11:00:00.000Z'),
          messageCount: 12,
        },
        {
          summaryText: 'Updated live text',
          generatedTs: Date.parse('2026-03-29T11:00:00.000Z'),
          messageCount: 12,
        }
      )
    ).toBeDefined();
  });
});
