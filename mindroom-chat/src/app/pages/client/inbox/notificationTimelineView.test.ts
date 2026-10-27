import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { getEventAttachmentOwner } from '../../../mindroom/messages/eventAttachments';
import { AsyncStatus } from '../../../hooks/useAsyncCallback';
import {
  resolveNotificationEvent,
  shouldRenderNotificationLoadingPlaceholders,
} from './notificationTimelineView';

describe('notificationTimelineView', () => {
  it('does not render loading placeholders while existing notification groups stay visible', () => {
    expect(shouldRenderNotificationLoadingPlaceholders(AsyncStatus.Loading, 1)).toBe(false);
  });

  it('renders loading placeholders for the initial empty load', () => {
    expect(shouldRenderNotificationLoadingPlaceholders(AsyncStatus.Loading, 0)).toBe(true);
  });
});

describe('notification event revisions', () => {
  const original = {
    event_id: '$original',
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.message',
    origin_server_ts: 1,
    content: { msgtype: 'm.image', body: 'old image', url: 'mxc://example.org/old' },
  };
  const setup = async () => {
    const mx = createClient({ baseUrl: 'https://example.org', userId: '@me:example.org' });
    const room = new Room(original.room_id, mx, '@me:example.org');
    const live = new MatrixEvent(structuredClone(original));
    await room.addLiveEvents([live], { addToState: false });
    return { room, live };
  };

  it('pairs the current inline edit with its current attachment owner', async () => {
    const { room, live } = await setup();
    live.makeReplaced(
      new MatrixEvent({
        ...original,
        event_id: '$edit',
        origin_server_ts: 2,
        content: {
          'm.relates_to': { rel_type: 'm.replace', event_id: original.event_id },
          'm.new_content': { msgtype: 'm.text', body: 'now inline' },
        },
      })
    );
    const selected = resolveNotificationEvent(room, original);
    expect(selected.getContent()).toEqual({ msgtype: 'm.text', body: 'now inline' });
    expect(getEventAttachmentOwner(selected)?.revisionId).toBe('$edit');
    expect(selected.getContent().url).toBeUndefined();
  });

  it.each([false, true])(
    'uses a newer bundled edit with a stale SDK replacement (encrypted=%s)',
    async (encrypted) => {
      const { room, live } = await setup();
      const edit = (id: string, ts: number, url: string) => ({
        ...original,
        event_id: id,
        origin_server_ts: ts,
        content: {
          'm.relates_to': { rel_type: 'm.replace', event_id: original.event_id },
          'm.new_content': { msgtype: 'm.image', body: id, url },
        },
      });
      if (encrypted) {
        live.event.type = 'm.room.encrypted';
        live.event.content = { ciphertext: 'encrypted' };
        live.setClearData({ clearEvent: { type: 'm.room.message', content: original.content } });
      }
      live.makeReplaced(new MatrixEvent(edit('$old-edit', 2, 'mxc://example.org/old-edit')));
      live.event.unsigned = {
        'm.relations': { 'm.replace': edit('$new-edit', 3, 'mxc://example.org/new-edit') },
      };
      const selected = resolveNotificationEvent(room, original);
      expect(selected.getContent().url).toBe('mxc://example.org/new-edit');
      expect(getEventAttachmentOwner(selected)?.revisionId).toBe('$new-edit');
      expect(live.replacingEvent()?.getId()).toBe('$old-edit');
    }
  );

  it('materializes the bundled edit of a notification absent from the SDK timeline', async () => {
    const { room } = await setup();
    const event = {
      ...original,
      event_id: '$detached',
      unsigned: {
        'm.relations': {
          'm.replace': {
            ...original,
            event_id: '$detached-edit',
            origin_server_ts: 2,
            content: {
              'm.relates_to': { rel_type: 'm.replace', event_id: '$detached' },
              'm.new_content': { msgtype: 'm.text', body: 'updated detached body' },
            },
          },
        },
      },
    };
    const selected = resolveNotificationEvent(room, event);
    expect(selected.getContent().body).toBe('updated detached body');
    expect(selected.getContent().url).toBeUndefined();
    expect(getEventAttachmentOwner(selected)?.revisionId).toBe('$detached-edit');
  });

  it('uses the SDK redaction even when the notification still contains media', async () => {
    const { room, live } = await setup();
    live.makeRedacted(
      new MatrixEvent({
        ...original,
        event_id: '$redaction',
        type: 'm.room.redaction',
        redacts: original.event_id,
        content: { reason: 'removed' },
      }),
      room
    );
    const selected = resolveNotificationEvent(room, original);
    expect(selected.isRedacted()).toBe(true);
    expect(selected.getContent().url).toBeUndefined();
  });

  it('preserves the notification identity and content when no SDK event exists', async () => {
    const { room } = await setup();
    const fallback = { ...original, event_id: '$not-in-timeline', room_id: undefined };
    const selected = resolveNotificationEvent(room, fallback);
    expect(selected.getId()).toBe(fallback.event_id);
    expect(selected.getRoomId()).toBe(room.roomId);
    expect(selected.getContent()).toEqual(fallback.content);
    expect(getEventAttachmentOwner(selected)?.eventId).toBe(fallback.event_id);
  });
});
