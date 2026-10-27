import { useParams } from 'react-router-dom';
import { useResolvedRoomIdOrAlias } from './useResolvedRoomIdOrAlias';

export const useSelectedRoomResolution = () => {
  const { roomIdOrAlias } = useParams();
  return useResolvedRoomIdOrAlias(roomIdOrAlias);
};

export const useSelectedRoom = (): string | undefined => useSelectedRoomResolution().roomId;
