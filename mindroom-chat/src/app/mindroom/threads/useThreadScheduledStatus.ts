import { useCallback, useMemo, useState } from 'react';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { useInterval } from '../../hooks/useInterval';
import {
  buildRoomThreadScheduledStatusMap,
  getThreadScheduledStatus,
  type ThreadScheduledStatus,
} from './threadScheduledStatus';
import { getScheduledTimeUpdateInterval } from './compactThreadCardUtils';
import { useScheduledTaskEvents } from './useScheduledTaskEvents';

export const useThreadScheduledStatus = (
  room: Room,
  threadRootId: string | undefined
): ThreadScheduledStatus => {
  const scheduledTaskEvents = useScheduledTaskEvents(room);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const refresh = useCallback(() => {
    setRefreshVersion((version) => version + 1);
  }, []);

  const scheduledStatus = useMemo(() => {
    // Timer ticks should invalidate Date.now() usage inside scheduled-status derivation.
    void refreshVersion;
    return getThreadScheduledStatus(
      buildRoomThreadScheduledStatusMap(scheduledTaskEvents),
      threadRootId
    );
  }, [scheduledTaskEvents, threadRootId, refreshVersion]);
  const intervalMs =
    scheduledStatus.nextScheduledTs === undefined
      ? -1
      : getScheduledTimeUpdateInterval(scheduledStatus.nextScheduledTs);
  useInterval(refresh, intervalMs);

  return scheduledStatus;
};
