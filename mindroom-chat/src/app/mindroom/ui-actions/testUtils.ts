import { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';

export const viewerId = '@alice:example.org';
export const agentId = '@mindroom_helper:example.org';
export const roomId = '!room:example.org';

export const makeUiEvent = (
  metadata: Record<string, unknown> = {},
  event: Record<string, unknown> = {}
) =>
  new MatrixEvent({
    event_id: '$request',
    room_id: roomId,
    sender: agentId,
    type: 'm.room.message',
    origin_server_ts: 100_000,
    content: {
      msgtype: 'm.notice',
      body: 'Watch my computer.',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$thread' },
      'io.mindroom.ui_action': {
        version: 1,
        action: 'show_computer',
        requester_id: viewerId,
        agent_user_id: agentId,
        room_id: roomId,
        thread_id: '$thread',
        ...metadata,
      },
    },
    ...event,
  });

export const makeUiRoom = () => {
  const mx = new MatrixClient({ baseUrl: 'https://example.org', userId: viewerId });
  const room = new Room(roomId, mx, viewerId);
  [viewerId, agentId, '@mindroom_second:example.org', '@mindroom_foreign:elsewhere.org'].forEach(
    (userId) => {
      room.currentState.setStateEvents([
        new MatrixEvent({
          event_id: `$member-${userId}`,
          room_id: roomId,
          sender: userId,
          type: 'm.room.member',
          state_key: userId,
          content: { membership: 'join' },
        }),
      ]);
    }
  );
  return { mx, room };
};
