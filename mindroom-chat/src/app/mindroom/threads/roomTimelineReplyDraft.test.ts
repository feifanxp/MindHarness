import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { getEditedEvent } from '../../utils/room';
import { buildMindroomRoomTimelineReplyDraft } from './roomTimelineReplyDraft';

vi.mock('../../utils/room', () => ({
  getEditedEvent: vi.fn(),
}));

const event = ({
  content,
  sender = '@sender:server',
  threadRootId,
  wireContent = {},
}: {
  content: Record<string, unknown>;
  sender?: string | undefined;
  threadRootId?: string;
  wireContent?: Record<string, unknown>;
}) =>
  ({
    getContent: () => content,
    getSender: () => sender,
    getWireContent: () => wireContent,
    threadRootId,
  } as unknown as MatrixEvent);

const roomWithEvent = (replyEvent: MatrixEvent | undefined) =>
  ({
    findEventById: vi.fn(() => replyEvent),
    getUnfilteredTimelineSet: vi.fn(() => ({})),
  } as unknown as Room);

describe('buildMindroomRoomTimelineReplyDraft', () => {
  beforeEach(() => {
    vi.mocked(getEditedEvent).mockReset();
    vi.mocked(getEditedEvent).mockReturnValue(undefined);
  });

  it('builds a reply draft from the original message content', () => {
    const relation = { event_id: '$root', rel_type: 'm.thread' };
    const replyEvent = event({
      content: { body: 'hello', formatted_body: '<b>hello</b>' },
      wireContent: { 'm.relates_to': relation },
    });

    expect(buildMindroomRoomTimelineReplyDraft(roomWithEvent(replyEvent), '$reply', false)).toEqual(
      {
        draft: {
          userId: '@sender:server',
          eventId: '$reply',
          body: 'hello',
          formattedBody: '<b>hello</b>',
          relation,
        },
        threadRootId: '$reply',
      }
    );
  });

  it('uses edited message content when an edit exists', () => {
    const replyEvent = event({ content: { body: 'old' } });
    vi.mocked(getEditedEvent).mockReturnValue(
      event({
        content: {
          'm.new_content': {
            body: 'edited',
            formatted_body: '<strong>edited</strong>',
          },
        },
      })
    );

    expect(
      buildMindroomRoomTimelineReplyDraft(roomWithEvent(replyEvent), '$reply', false)?.draft
    ).toMatchObject({
      body: 'edited',
      formattedBody: '<strong>edited</strong>',
    });
  });

  it('previews a canvas by its title, not the fallback for other clients', () => {
    const replyEvent = event({
      content: {
        msgtype: 'm.notice',
        body: 'Interactive panel: Pick a time. Open it in MindRoom Chat to respond.',
        'io.mindroom.ui_action': {
          version: 1,
          action: 'show_canvas',
          canvas: { title: 'Pick a time', html: '<p></p>' },
        },
      },
    });

    expect(
      buildMindroomRoomTimelineReplyDraft(roomWithEvent(replyEvent), '$canvas', false)?.draft
    ).toMatchObject({
      body: 'Interactive panel: Pick a time. Open it in MindRoom Chat to respond.',
      previewText: 'Pick a time',
    });
  });

  it('builds the thread relation when starting a thread from a normal message', () => {
    const replyEvent = event({ content: { body: 'root' } });

    expect(buildMindroomRoomTimelineReplyDraft(roomWithEvent(replyEvent), '$root', true)).toEqual({
      draft: {
        userId: '@sender:server',
        eventId: '$root',
        body: 'root',
        formattedBody: undefined,
        relation: {
          event_id: '$root',
          rel_type: 'm.thread',
        },
      },
      threadRootId: '$root',
    });
  });

  it('does not create a draft for missing events or non-text bodies', () => {
    expect(buildMindroomRoomTimelineReplyDraft(roomWithEvent(undefined), '$missing', false)).toBe(
      undefined
    );
    expect(
      buildMindroomRoomTimelineReplyDraft(
        roomWithEvent(event({ content: { body: { object: true } } })),
        '$reply',
        false
      )
    ).toBe(undefined);
  });
});
