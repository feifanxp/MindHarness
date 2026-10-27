import { describe, expect, it, vi } from 'vitest';
import { EventType, MatrixEvent } from 'matrix-js-sdk';
import { CALL_FAILURE_CONTENT_KEY, getCallFailureNotice } from './callFailureNotice';

const VIEWER_USER_ID = '@alice:example.org';

const messageEvent = (
  content: Record<string, unknown>,
  type = EventType.RoomMessage,
  sender = '@mindroom_agent:example.org'
) =>
  new MatrixEvent({
    event_id: '$event',
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender,
    type,
    content,
  });

describe('getCallFailureNotice', () => {
  it('returns marked call failure notices', () => {
    const event = messageEvent({
      msgtype: 'm.notice',
      body: 'Voice call error: update the provider credential and restart MindRoom.',
      [CALL_FAILURE_CONTENT_KEY]: { version: 1 },
    });

    expect(getCallFailureNotice(event, VIEWER_USER_ID)).toBe(
      'Voice call error: update the provider credential and restart MindRoom.'
    );
  });

  it('ignores ordinary room notices', () => {
    const event = messageEvent({ msgtype: 'm.notice', body: 'Ordinary agent notice.' });

    expect(getCallFailureNotice(event, VIEWER_USER_ID)).toBeUndefined();
  });

  it('ignores malformed marked events', () => {
    expect(
      getCallFailureNotice(
        messageEvent({
          msgtype: 'm.notice',
          body: '   ',
          [CALL_FAILURE_CONTENT_KEY]: { version: 1 },
        }),
        VIEWER_USER_ID
      )
    ).toBeUndefined();
    expect(
      getCallFailureNotice(
        messageEvent({
          msgtype: 'm.text',
          body: 'Not a notice.',
          [CALL_FAILURE_CONTENT_KEY]: { version: 1 },
        }),
        VIEWER_USER_ID
      )
    ).toBeUndefined();
  });

  it('ignores marked notices from untrusted senders', () => {
    const content = {
      msgtype: 'm.notice',
      body: 'Spoofed call failure.',
      [CALL_FAILURE_CONTENT_KEY]: { version: 1 },
    };

    expect(
      getCallFailureNotice(
        messageEvent(content, EventType.RoomMessage, '@mallory:example.org'),
        VIEWER_USER_ID
      )
    ).toBeUndefined();
    expect(
      getCallFailureNotice(
        messageEvent(content, EventType.RoomMessage, '@mindroom_agent:evil.example'),
        VIEWER_USER_ID
      )
    ).toBeUndefined();
  });

  it('ignores marked redacted events without content', () => {
    const event = messageEvent({
      msgtype: 'm.notice',
      body: 'Removed failure.',
      [CALL_FAILURE_CONTENT_KEY]: { version: 1 },
    });
    vi.spyOn(event, 'getContent').mockReturnValue(undefined as never);

    expect(getCallFailureNotice(event, VIEWER_USER_ID)).toBeUndefined();
  });
});
