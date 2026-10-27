import type { MatrixClient } from 'matrix-js-sdk';
import { generatePath, matchPath } from 'react-router-dom';
import {
  DIRECT_ROOM_PATH,
  HOME_ROOM_PATH,
  SPACE_LOBBY_PATH,
  SPACE_PATH,
  SPACE_ROOM_PATH,
  SPACE_SEARCH_PATH,
} from '../../pages/paths';
import { getCanonicalAliasRoomId, isRoomAlias } from '../../utils/matrix';

const MINDROOM_ROUTE_PARSE_BASE_URL = 'https://mindroom.local';

export const parseMindroomStoredRouteUrl = (storedPath: string): URL | undefined => {
  try {
    return new URL(storedPath, MINDROOM_ROUTE_PARSE_BASE_URL);
  } catch {
    return undefined;
  }
};

const decodeRouteParam = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const canonicalizeRouteParam = (
  mx: MatrixClient,
  value: string | undefined
): string | undefined => {
  const decodedValue = decodeRouteParam(value);
  if (!decodedValue) return decodedValue;
  if (!isRoomAlias(decodedValue)) return decodedValue;
  return getCanonicalAliasRoomId(mx, decodedValue) ?? decodedValue;
};

const hasAliasRouteParam = (value: string | undefined): boolean => {
  const decodedValue = decodeRouteParam(value);
  return !!decodedValue && isRoomAlias(decodedValue);
};

const encodeMaybeDecodedRouteParam = (value: string | undefined): string | null =>
  value ? encodeURIComponent(decodeRouteParam(value) ?? value) : null;

export const pathnameContainsAliasRoute = (pathname: string): boolean => {
  const homeRoomMatch = matchPath(
    { path: HOME_ROOM_PATH, caseSensitive: true, end: true },
    pathname
  );
  if (homeRoomMatch) {
    return hasAliasRouteParam(homeRoomMatch.params.roomIdOrAlias);
  }

  const directRoomMatch = matchPath(
    { path: DIRECT_ROOM_PATH, caseSensitive: true, end: true },
    pathname
  );
  if (directRoomMatch) {
    return hasAliasRouteParam(directRoomMatch.params.roomIdOrAlias);
  }

  const spaceRoomMatch = matchPath(
    { path: SPACE_ROOM_PATH, caseSensitive: true, end: true },
    pathname
  );
  if (spaceRoomMatch) {
    return (
      hasAliasRouteParam(spaceRoomMatch.params.spaceIdOrAlias) ||
      hasAliasRouteParam(spaceRoomMatch.params.roomIdOrAlias)
    );
  }

  const spaceOnlyMatch = matchPath({ path: SPACE_PATH, caseSensitive: true, end: true }, pathname);
  if (spaceOnlyMatch) {
    return hasAliasRouteParam(spaceOnlyMatch.params.spaceIdOrAlias);
  }

  const spaceLobbyMatch = matchPath(
    { path: SPACE_LOBBY_PATH, caseSensitive: true, end: true },
    pathname
  );
  if (spaceLobbyMatch) {
    return hasAliasRouteParam(spaceLobbyMatch.params.spaceIdOrAlias);
  }

  const spaceSearchMatch = matchPath(
    { path: SPACE_SEARCH_PATH, caseSensitive: true, end: true },
    pathname
  );
  if (spaceSearchMatch) {
    return hasAliasRouteParam(spaceSearchMatch.params.spaceIdOrAlias);
  }

  return false;
};

const resolveCanonicalRouteParam = async (
  mx: MatrixClient,
  value: string | undefined
): Promise<string | undefined> => {
  const decodedValue = decodeRouteParam(value);
  if (!decodedValue) return decodedValue;
  if (!isRoomAlias(decodedValue)) return decodedValue;

  const knownRoomId = getCanonicalAliasRoomId(mx, decodedValue);
  if (knownRoomId) return knownRoomId;

  try {
    const response = await mx.getRoomIdForAlias(decodedValue);
    return response.room_id ?? decodedValue;
  } catch {
    return decodedValue;
  }
};

export const canonicalizeSessionPathname = (mx: MatrixClient, pathname: string): string => {
  const homeRoomMatch = matchPath(
    { path: HOME_ROOM_PATH, caseSensitive: true, end: true },
    pathname
  );
  if (homeRoomMatch) {
    return generatePath(HOME_ROOM_PATH, {
      roomIdOrAlias: encodeURIComponent(
        canonicalizeRouteParam(mx, homeRoomMatch.params.roomIdOrAlias) ??
          homeRoomMatch.params.roomIdOrAlias!
      ),
      eventId: encodeMaybeDecodedRouteParam(homeRoomMatch.params.eventId),
    });
  }

  const directRoomMatch = matchPath(
    { path: DIRECT_ROOM_PATH, caseSensitive: true, end: true },
    pathname
  );
  if (directRoomMatch) {
    return generatePath(DIRECT_ROOM_PATH, {
      roomIdOrAlias: encodeURIComponent(
        canonicalizeRouteParam(mx, directRoomMatch.params.roomIdOrAlias) ??
          directRoomMatch.params.roomIdOrAlias!
      ),
      eventId: encodeMaybeDecodedRouteParam(directRoomMatch.params.eventId),
    });
  }

  const spaceRoomMatch = matchPath(
    { path: SPACE_ROOM_PATH, caseSensitive: true, end: true },
    pathname
  );
  if (spaceRoomMatch) {
    return generatePath(SPACE_ROOM_PATH, {
      spaceIdOrAlias: encodeURIComponent(
        canonicalizeRouteParam(mx, spaceRoomMatch.params.spaceIdOrAlias) ??
          spaceRoomMatch.params.spaceIdOrAlias!
      ),
      roomIdOrAlias: encodeURIComponent(
        canonicalizeRouteParam(mx, spaceRoomMatch.params.roomIdOrAlias) ??
          spaceRoomMatch.params.roomIdOrAlias!
      ),
      eventId: encodeMaybeDecodedRouteParam(spaceRoomMatch.params.eventId),
    });
  }

  const spaceOnlyMatch = matchPath({ path: SPACE_PATH, caseSensitive: true, end: true }, pathname);
  if (spaceOnlyMatch) {
    return generatePath(SPACE_PATH, {
      spaceIdOrAlias: encodeURIComponent(
        canonicalizeRouteParam(mx, spaceOnlyMatch.params.spaceIdOrAlias) ??
          spaceOnlyMatch.params.spaceIdOrAlias!
      ),
    });
  }

  const spaceLobbyMatch = matchPath(
    { path: SPACE_LOBBY_PATH, caseSensitive: true, end: true },
    pathname
  );
  if (spaceLobbyMatch) {
    return generatePath(SPACE_LOBBY_PATH, {
      spaceIdOrAlias: encodeURIComponent(
        canonicalizeRouteParam(mx, spaceLobbyMatch.params.spaceIdOrAlias) ??
          spaceLobbyMatch.params.spaceIdOrAlias!
      ),
    });
  }

  const spaceSearchMatch = matchPath(
    { path: SPACE_SEARCH_PATH, caseSensitive: true, end: true },
    pathname
  );
  if (spaceSearchMatch) {
    return generatePath(SPACE_SEARCH_PATH, {
      spaceIdOrAlias: encodeURIComponent(
        canonicalizeRouteParam(mx, spaceSearchMatch.params.spaceIdOrAlias) ??
          spaceSearchMatch.params.spaceIdOrAlias!
      ),
    });
  }

  return pathname;
};

export const resolveCanonicalizedPathname = async (
  mx: MatrixClient,
  pathname: string
): Promise<string> => {
  const homeRoomMatch = matchPath(
    { path: HOME_ROOM_PATH, caseSensitive: true, end: true },
    pathname
  );
  if (homeRoomMatch) {
    return generatePath(HOME_ROOM_PATH, {
      roomIdOrAlias: encodeURIComponent(
        (await resolveCanonicalRouteParam(mx, homeRoomMatch.params.roomIdOrAlias)) ??
          homeRoomMatch.params.roomIdOrAlias!
      ),
      eventId: encodeMaybeDecodedRouteParam(homeRoomMatch.params.eventId),
    });
  }

  const directRoomMatch = matchPath(
    { path: DIRECT_ROOM_PATH, caseSensitive: true, end: true },
    pathname
  );
  if (directRoomMatch) {
    return generatePath(DIRECT_ROOM_PATH, {
      roomIdOrAlias: encodeURIComponent(
        (await resolveCanonicalRouteParam(mx, directRoomMatch.params.roomIdOrAlias)) ??
          directRoomMatch.params.roomIdOrAlias!
      ),
      eventId: encodeMaybeDecodedRouteParam(directRoomMatch.params.eventId),
    });
  }

  const spaceRoomMatch = matchPath(
    { path: SPACE_ROOM_PATH, caseSensitive: true, end: true },
    pathname
  );
  if (spaceRoomMatch) {
    const [spaceIdOrAlias, roomIdOrAlias] = await Promise.all([
      resolveCanonicalRouteParam(mx, spaceRoomMatch.params.spaceIdOrAlias),
      resolveCanonicalRouteParam(mx, spaceRoomMatch.params.roomIdOrAlias),
    ]);

    return generatePath(SPACE_ROOM_PATH, {
      spaceIdOrAlias: encodeURIComponent(spaceIdOrAlias ?? spaceRoomMatch.params.spaceIdOrAlias!),
      roomIdOrAlias: encodeURIComponent(roomIdOrAlias ?? spaceRoomMatch.params.roomIdOrAlias!),
      eventId: encodeMaybeDecodedRouteParam(spaceRoomMatch.params.eventId),
    });
  }

  const spaceOnlyMatch = matchPath({ path: SPACE_PATH, caseSensitive: true, end: true }, pathname);
  if (spaceOnlyMatch) {
    return generatePath(SPACE_PATH, {
      spaceIdOrAlias: encodeURIComponent(
        (await resolveCanonicalRouteParam(mx, spaceOnlyMatch.params.spaceIdOrAlias)) ??
          spaceOnlyMatch.params.spaceIdOrAlias!
      ),
    });
  }

  const spaceLobbyMatch = matchPath(
    { path: SPACE_LOBBY_PATH, caseSensitive: true, end: true },
    pathname
  );
  if (spaceLobbyMatch) {
    return generatePath(SPACE_LOBBY_PATH, {
      spaceIdOrAlias: encodeURIComponent(
        (await resolveCanonicalRouteParam(mx, spaceLobbyMatch.params.spaceIdOrAlias)) ??
          spaceLobbyMatch.params.spaceIdOrAlias!
      ),
    });
  }

  const spaceSearchMatch = matchPath(
    { path: SPACE_SEARCH_PATH, caseSensitive: true, end: true },
    pathname
  );
  if (spaceSearchMatch) {
    return generatePath(SPACE_SEARCH_PATH, {
      spaceIdOrAlias: encodeURIComponent(
        (await resolveCanonicalRouteParam(mx, spaceSearchMatch.params.spaceIdOrAlias)) ??
          spaceSearchMatch.params.spaceIdOrAlias!
      ),
    });
  }

  return pathname;
};
