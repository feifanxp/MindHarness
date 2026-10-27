import { useAtomValue } from 'jotai';
import { useRef, useState } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useAlive } from '../../hooks/useAlive';
import { archivedRoomsAtom, setRoomArchived } from './archivedRooms';

export const useRoomArchiveAction = (roomId: string, onDone?: () => void) => {
  const mx = useMatrixClient();
  const archived = useAtomValue(archivedRoomsAtom).has(roomId);
  const alive = useAlive();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const toggle = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFailed(false);
    try {
      await setRoomArchived(mx, roomId, !archived);
      onDone?.();
    } catch {
      if (alive()) setFailed(true);
    } finally {
      pending.current = false;
      if (alive()) setBusy(false);
    }
  };

  return { archived, busy, failed, toggle };
};
