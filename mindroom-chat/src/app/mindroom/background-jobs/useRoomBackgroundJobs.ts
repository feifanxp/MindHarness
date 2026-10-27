import type { Room } from 'matrix-js-sdk';
import { useMemo } from 'react';
import { agentRoomState, useAgentRoomStateVersion } from '../matrix/agentRoomState';
import {
  type BackgroundJob,
  MINDROOM_BACKGROUND_JOBS_EVENT,
  selectBackgroundJobs,
} from './backgroundJobsContract';

/** Every live background job of the room, read again only when its agents' jobs state could have changed. */
export const useRoomBackgroundJobs = (room: Room): BackgroundJob[] => {
  const version = useAgentRoomStateVersion(room, MINDROOM_BACKGROUND_JOBS_EVENT);
  return useMemo(() => {
    void version;
    return selectBackgroundJobs(agentRoomState(room, MINDROOM_BACKGROUND_JOBS_EVENT));
  }, [room, version]);
};
