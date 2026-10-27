import { MatrixEvent, type Thread } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { sortThreadsByActivity } from './roomThreadList';

const reply = (id: string, ts: number) =>
  new MatrixEvent({
    event_id: id,
    sender: '@other:example.org',
    origin_server_ts: ts,
    type: 'm.room.message',
    content: {
      msgtype: 'm.text',
      body: id,
      'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
    },
  });

describe('large room thread ordering', () => {
  it('reads only the visible tail once per thread when sorting long histories', () => {
    let historyReads = 0;
    const threads = Array.from({ length: 40 }, (_, index) => {
      const events = Array.from({ length: 600 }, (_, n) =>
        reply(`$${index}-${n}`, index * 1000 + n)
      );
      const history = new Proxy(events, {
        get(target, key, receiver) {
          if (typeof key === 'string' && /^\d+$/.test(key)) historyReads += 1;
          return Reflect.get(target, key, receiver);
        },
      });
      return { id: `$root-${index}`, events: history } as unknown as Thread;
    });
    const sorted = sortThreadsByActivity(threads);
    expect(sorted.map((thread) => thread.id)).toEqual(
      Array.from({ length: 40 }, (_, index) => `$root-${39 - index}`)
    );
    expect(threads[0].id).toBe('$root-0');
    expect(historyReads).toBe(40);
  });

  it('preserves unread-first ordering, stable ties, and a visible bundled reply after a hidden tail', () => {
    const hidden = reply('$hidden', 1000);
    hidden.event.type = 'm.reaction';
    const threads = [
      { id: '$read', events: [reply('$latest', 500)] },
      { id: '$unread-a', events: [hidden], replyToEvent: reply('$bundle', 200) },
      { id: '$unread-b', events: [reply('$same-time', 200)] },
    ] as unknown as Thread[];
    expect(
      sortThreadsByActivity(
        threads,
        new Map([
          ['$unread-a', true],
          ['$unread-b', true],
        ])
      ).map((thread) => thread.id)
    ).toEqual(['$unread-a', '$unread-b', '$read']);
  });
});
