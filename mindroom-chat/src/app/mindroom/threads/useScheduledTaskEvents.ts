import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { useMemo } from 'react';
import { isMindroomAgentUserIdForViewer } from '../matrix/agentIdentity';
import { MINDROOM_SCHEDULED_TASK_EVENT } from './scheduledTaskContract';
import { useStateEvents } from './useStateEvents';

/**
 * The room's scheduled-task state written by MindRoom accounts on the viewer's homeserver.
 * Any member with state power can write this event type, and the backend runs only the
 * tasks its own accounts wrote, so state from anyone else is not a schedule.
 */
export const useScheduledTaskEvents = (room: Room): MatrixEvent[] => {
  const events = useStateEvents(room, MINDROOM_SCHEDULED_TASK_EVENT);
  return useMemo(
    () =>
      events.filter((event) => isMindroomAgentUserIdForViewer(event.getSender(), room.myUserId)),
    [events, room.myUserId]
  );
};
