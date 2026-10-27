import type { Room } from 'matrix-js-sdk/lib/models/room';
import { useThreadScheduledStatus } from './useThreadScheduledStatus';

export const useThreadScheduledTasks = (room: Room, threadRootId: string | undefined): number =>
  useThreadScheduledStatus(room, threadRootId).scheduledTaskCount;
