import { describe, expect, it, vi } from 'vitest';
import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import {
  buildRoomThreadScheduledStatusMap,
  getNextThreadScheduledTs,
  getRoomScheduledTaskCounts,
  getThreadScheduledStatus,
} from './threadScheduledStatus';

const makeScheduledEvent = ({
  stateKey = 'task',
  status = 'pending',
  threadId = '$thread',
  newThread = false,
  executeAt,
  cronDescription,
}: {
  stateKey?: string;
  status?: string;
  threadId?: string | null;
  newThread?: boolean;
  executeAt?: string | null;
  cronDescription?: string;
}): MatrixEvent =>
  ({
    getStateKey: () => stateKey,
    getContent: () => ({
      status,
      thread_id: threadId,
      new_thread: newThread,
      execute_at: executeAt,
      cron_description: cronDescription,
    }),
  } as unknown as MatrixEvent);

describe('threadScheduledStatus', () => {
  it('groups pending future scheduled tasks by thread', () => {
    const now = Date.parse('2026-04-04T18:00:00.000Z');
    const futureDate = '2026-04-04T19:00:00.000Z';
    const pastDate = '2026-04-04T17:00:00.000Z';

    const statusMap = buildRoomThreadScheduledStatusMap(
      [
        makeScheduledEvent({ stateKey: 'task-1', threadId: '$thread-1', executeAt: futureDate }),
        makeScheduledEvent({ stateKey: 'task-2', threadId: '$thread-1', executeAt: futureDate }),
        makeScheduledEvent({ stateKey: 'task-3', threadId: '$thread-2', executeAt: futureDate }),
        makeScheduledEvent({ stateKey: 'task-4', status: 'completed', threadId: '$thread-1' }),
        makeScheduledEvent({ stateKey: 'task-5', threadId: '$thread-1', newThread: true }),
        makeScheduledEvent({ stateKey: 'task-6', threadId: '$thread-3', executeAt: pastDate }),
        makeScheduledEvent({ stateKey: 'task-7', threadId: null, executeAt: futureDate }),
      ],
      now
    );

    expect(getThreadScheduledStatus(statusMap, '$thread-1')).toEqual({
      scheduledTaskCount: 2,
      nextScheduledTs: Date.parse(futureDate),
    });
    expect(getThreadScheduledStatus(statusMap, '$thread-2')).toEqual({
      scheduledTaskCount: 1,
      nextScheduledTs: Date.parse(futureDate),
    });
    expect(statusMap.has('$thread-3')).toBe(false);
  });

  it.each(['America/Los_Angeles', 'Asia/Tokyo'])(
    'uses scheduler UTC timing outside UTC (%s)',
    (timezone) => {
      vi.stubEnv('TZ', timezone);
      try {
        const statusMap = buildRoomThreadScheduledStatusMap(
          [
            makeScheduledEvent({ stateKey: 'future', executeAt: '2026-09-16T09:30:00' }),
            makeScheduledEvent({ stateKey: 'expired', executeAt: '2026-09-16 08:30:00' }),
          ],
          Date.parse('2026-09-16T09:00:00Z')
        );

        expect(getThreadScheduledStatus(statusMap, '$thread')).toEqual({
          scheduledTaskCount: 1,
          nextScheduledTs: 1789551000000,
        });
      } finally {
        vi.unstubAllEnvs();
      }
    }
  );

  it('uses count fallback when any task lacks a trustworthy timestamp', () => {
    const statusMap = buildRoomThreadScheduledStatusMap(
      [
        makeScheduledEvent({ stateKey: 'task-1', executeAt: undefined }),
        makeScheduledEvent({ stateKey: 'task-2', executeAt: 'not-a-date' }),
        makeScheduledEvent({
          stateKey: 'task-3',
          executeAt: '2026-04-04T18:05:00.000Z',
        }),
      ],
      Date.parse('2026-04-04T18:00:00.000Z')
    );

    expect(getThreadScheduledStatus(statusMap, '$thread')).toEqual({
      scheduledTaskCount: 3,
      nextScheduledTs: undefined,
    });
  });

  it('keeps count fallback when a timestamp-less task is between timestamped tasks', () => {
    const statusMap = buildRoomThreadScheduledStatusMap(
      [
        makeScheduledEvent({ stateKey: 'once-1', executeAt: '2026-04-04T18:05:00.000Z' }),
        makeScheduledEvent({ stateKey: 'cron', cronDescription: 'At 09:00' }),
        makeScheduledEvent({ stateKey: 'once-2', executeAt: '2026-04-04T18:10:00.000Z' }),
      ],
      Date.parse('2026-04-04T18:00:00.000Z')
    );

    expect(getThreadScheduledStatus(statusMap, '$thread')).toEqual({
      scheduledTaskCount: 3,
      nextScheduledTs: undefined,
    });
  });

  it('exposes a backend cron description only for one recurring task', () => {
    const now = Date.parse('2026-04-04T18:00:00.000Z');
    const singleStatusMap = buildRoomThreadScheduledStatusMap(
      [makeScheduledEvent({ cronDescription: 'At 09:00' })],
      now
    );

    expect(getThreadScheduledStatus(singleStatusMap, '$thread')).toEqual({
      scheduledTaskCount: 1,
      nextScheduledTs: undefined,
      cronDescription: 'At 09:00',
    });

    const multipleStatusMap = buildRoomThreadScheduledStatusMap(
      [
        makeScheduledEvent({ stateKey: 'cron', cronDescription: 'At 09:00' }),
        makeScheduledEvent({
          stateKey: 'once',
          executeAt: '2026-04-04T18:05:00.000Z',
        }),
      ],
      now
    );

    expect(getThreadScheduledStatus(multipleStatusMap, '$thread')).toEqual({
      scheduledTaskCount: 2,
      nextScheduledTs: undefined,
    });
  });

  it('exposes count and next-time compatibility selectors from the same status map logic', () => {
    const events = [
      makeScheduledEvent({ stateKey: 'task-1', executeAt: '2026-04-04T18:15:00.000Z' }),
      makeScheduledEvent({ stateKey: 'task-2', executeAt: '2026-04-04T18:05:00.000Z' }),
    ];
    const now = Date.parse('2026-04-04T18:00:00.000Z');

    expect(getRoomScheduledTaskCounts(events, now).get('$thread')).toBe(2);
    expect(getNextThreadScheduledTs(events, '$thread', now)).toBe(
      Date.parse('2026-04-04T18:05:00.000Z')
    );
  });
});
