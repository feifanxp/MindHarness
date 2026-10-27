import { useMemo } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import {
  RoomOrderBySpaceAtom,
  SpaceOrderAtom,
  makeRoomOrderBySpaceAtom,
  makeSpaceOrderAtom,
} from '../sidebarOrder';

export const useSpaceOrderAtom = (): SpaceOrderAtom => {
  const mx = useMatrixClient();
  const userId = mx.getUserId();

  if (!userId) throw new Error('SpaceOrderAtom requires an authenticated user!');
  return useMemo(() => makeSpaceOrderAtom(userId), [userId]);
};

export const useRoomOrderBySpaceAtom = (): RoomOrderBySpaceAtom => {
  const mx = useMatrixClient();
  const userId = mx.getUserId();

  if (!userId) throw new Error('RoomOrderBySpaceAtom requires an authenticated user!');
  return useMemo(() => makeRoomOrderBySpaceAtom(userId), [userId]);
};
