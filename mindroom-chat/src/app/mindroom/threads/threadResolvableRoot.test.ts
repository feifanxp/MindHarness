import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import { describe, expect, it, vi } from 'vitest';
import { getResolvableThreadRootEvent } from './threadResolvableRoot';

const makeMessageEvent = (
  eventId: string,
  options: { isThreadRoot?: boolean; isSending?: boolean; msgtype?: string } = {}
) => {
  const event = new MatrixEvent({
    content: {
      body: 'Root',
      msgtype: options.msgtype ?? 'm.text',
    },
    event_id: eventId,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.message',
  });

  Object.defineProperty(event, 'isThreadRoot', {
    value: options.isThreadRoot === true,
    configurable: true,
  });

  if (options.isSending !== undefined) {
    vi.spyOn(event, 'isSending').mockReturnValue(options.isSending);
  }

  return event;
};

describe('getResolvableThreadRootEvent', () => {
  it('accepts SDK-recognized thread roots', () => {
    const root = makeMessageEvent('$root', { isThreadRoot: true });
    const room = {
      findEventById: () => undefined,
      getThread: () => ({ rootEvent: root }),
    };

    expect(getResolvableThreadRootEvent(room as never, '$root')).toBe(root);
  });

  it('accepts stable standalone zero-reply message roots', () => {
    const standaloneRoot = makeMessageEvent('$standalone');
    const room = {
      findEventById: (eventId: string) => (eventId === '$standalone' ? standaloneRoot : undefined),
      getThread: () => undefined,
    };

    expect(getResolvableThreadRootEvent(room as never, '$standalone')).toBe(standaloneRoot);
  });

  it('rejects standalone notices', () => {
    const notice = makeMessageEvent('$notice', { msgtype: 'm.notice' });
    const room = {
      findEventById: (eventId: string) => (eventId === '$notice' ? notice : undefined),
      getThread: () => undefined,
    };

    expect(getResolvableThreadRootEvent(room as never, '$notice')).toBeUndefined();
  });

  it('rejects pending local echoes because their event id can still change', () => {
    const pendingRoot = makeMessageEvent('~pending', { isSending: true });
    const room = {
      findEventById: (eventId: string) => (eventId === '~pending' ? pendingRoot : undefined),
      getThread: () => undefined,
    };

    expect(getResolvableThreadRootEvent(room as never, '~pending')).toBeUndefined();
  });
});
