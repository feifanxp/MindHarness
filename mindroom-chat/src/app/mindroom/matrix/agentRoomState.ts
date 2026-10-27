import {
  RoomEvent,
  RoomStateEvent,
  type MatrixEvent,
  type Room,
  type RoomMember,
  type RoomState,
} from 'matrix-js-sdk';
import { useEffect } from 'react';
import { useForceUpdate } from '../../hooks/useForceUpdate';
import { isMindroomAgentUserIdForViewer } from './agentIdentity';

/**
 * Whether a state event is a MindRoom agent describing itself: keyed by its own user ID, which Matrix
 * accepts only from that user, and sent by an agent on the viewer's homeserver.
 */
export const isAgentSelfState = (event: MatrixEvent, viewerUserId: string | undefined): boolean => {
  const sender = event.getSender();
  return (
    !!sender &&
    event.getStateKey() === sender &&
    isMindroomAgentUserIdForViewer(sender, viewerUserId)
  );
};

/**
 * The state agents published about themselves, from agents still in the room. An agent known to have
 * left cannot clear its state, so it is ignored; one whose membership is not loaded yet, as with
 * lazy-loaded members, counts as joined until its member event says otherwise.
 */
export const selectAgentSelfState = (
  events: MatrixEvent[],
  viewerUserId: string | undefined,
  isJoined: (userId: string) => boolean
): MatrixEvent[] =>
  events.filter((event) => isAgentSelfState(event, viewerUserId) && isJoined(event.getSender()!));

/** The room's current state of one type that its agents published about themselves. */
export const agentRoomState = (room: Room, eventType: string): MatrixEvent[] =>
  selectAgentSelfState(room.currentState.getStateEvents(eventType), room.myUserId, (userId) => {
    const member = room.getMember(userId);
    return member === null || member.membership === 'join';
  });

/** A number that changes when the room's state of this type, an agent's membership, or its live state does. */
export const useAgentRoomStateVersion = (room: Room, eventType: string): number => {
  const [version, refresh] = useForceUpdate();
  useEffect(() => {
    const onState = (event: MatrixEvent) => {
      if (event.getType() === eventType) refresh();
    };
    const onMember = (_event: MatrixEvent, _state: RoomState, member: RoomMember) => {
      if (isMindroomAgentUserIdForViewer(member.userId, room.myUserId)) refresh();
    };
    room.on(RoomStateEvent.Events, onState);
    room.on(RoomStateEvent.Members, onMember);
    room.on(RoomEvent.CurrentStateUpdated, refresh);
    return () => {
      room.removeListener(RoomStateEvent.Events, onState);
      room.removeListener(RoomStateEvent.Members, onMember);
      room.removeListener(RoomEvent.CurrentStateUpdated, refresh);
    };
  }, [room, eventType, refresh]);
  return version;
};
