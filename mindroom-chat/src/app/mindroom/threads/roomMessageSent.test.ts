import { describe, expect, it } from 'vitest';
import { getRoomMessageSentNotificationEventId } from './roomMessageSent';

describe('getRoomMessageSentNotificationEventId', () => {
  it('returns the event id for root sends only', () => {
    expect(
      getRoomMessageSentNotificationEventId({
        eventId: '$root',
        relation: undefined,
        replyDraft: undefined,
        threadId: undefined,
      })
    ).toBe('$root');
  });

  it('skips related, threaded, reply, and missing-event sends', () => {
    expect(
      getRoomMessageSentNotificationEventId({
        eventId: '$reply',
        relation: { rel_type: 'm.thread' },
        replyDraft: undefined,
        threadId: undefined,
      })
    ).toBeUndefined();
    expect(
      getRoomMessageSentNotificationEventId({
        eventId: '$thread',
        relation: undefined,
        replyDraft: undefined,
        threadId: '$existing-thread',
      })
    ).toBeUndefined();
    expect(
      getRoomMessageSentNotificationEventId({
        eventId: '$draft',
        relation: undefined,
        replyDraft: { eventId: '$parent' },
        threadId: undefined,
      })
    ).toBeUndefined();
    expect(
      getRoomMessageSentNotificationEventId({
        eventId: undefined,
        relation: undefined,
        replyDraft: undefined,
        threadId: undefined,
      })
    ).toBeUndefined();
  });
});
