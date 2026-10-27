import { useMatch, useParams } from 'react-router-dom';
import { getSpaceLobbyPath, getSpaceSearchPath } from '../../pages/pathUtils';
import { useResolvedRoomIdOrAlias } from './useResolvedRoomIdOrAlias';

export const useSelectedSpaceResolution = () => {
  const { spaceIdOrAlias } = useParams();
  return useResolvedRoomIdOrAlias(spaceIdOrAlias);
};

export const useSelectedSpace = (): string | undefined => useSelectedSpaceResolution().roomId;

export const useSpaceLobbySelected = (spaceIdOrAlias: string): boolean => {
  const match = useMatch({
    path: decodeURIComponent(getSpaceLobbyPath(spaceIdOrAlias)),
    caseSensitive: true,
    end: false,
  });

  return !!match;
};

export const useSpaceSearchSelected = (spaceIdOrAlias: string): boolean => {
  const match = useMatch({
    path: decodeURIComponent(getSpaceSearchPath(spaceIdOrAlias)),
    caseSensitive: true,
    end: false,
  });

  return !!match;
};
