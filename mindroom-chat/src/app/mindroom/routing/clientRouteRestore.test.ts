import type { MatrixClient } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  canonicalizeSessionPathname,
  parseMindroomStoredRouteUrl,
  pathnameContainsAliasRoute,
  resolveCanonicalizedPathname,
} from './clientRouteRestore';

const makeRoom = (roomId: string, alias?: string) => ({
  roomId,
  getCanonicalAlias: () => alias,
  getLiveTimeline: () => ({
    getState: () => ({
      getStateEvents: () => undefined,
    }),
  }),
});

const makeMatrixClient = ({
  rooms = [],
  resolvedAliases = {},
}: {
  rooms?: Array<ReturnType<typeof makeRoom>>;
  resolvedAliases?: Record<string, string>;
} = {}) =>
  ({
    getRooms: () => rooms,
    getRoomIdForAlias: vi.fn(async (alias: string) => ({
      room_id: resolvedAliases[alias],
    })),
  } as unknown as MatrixClient);

describe('clientRouteRestore', () => {
  it('parses stored relative routes with a stable MindRoom base URL', () => {
    expect(parseMindroomStoredRouteUrl('/home/%21room%3Amindroom.chat/')?.pathname).toBe(
      '/home/%21room%3Amindroom.chat/'
    );
    expect(parseMindroomStoredRouteUrl('http://[')).toBeUndefined();
  });

  it('detects alias routes before rendering children that would flash join fallbacks', () => {
    expect(pathnameContainsAliasRoute('/home/%23room%3Amindroom.chat/')).toBe(true);
    expect(pathnameContainsAliasRoute('/%23space%3Amindroom.chat/%21room%3Amindroom.chat/')).toBe(
      true
    );
    expect(pathnameContainsAliasRoute('/home/%21room%3Amindroom.chat/')).toBe(false);
  });

  it('canonicalizes known aliases before persisting the active session path', () => {
    const mx = makeMatrixClient({
      rooms: [
        makeRoom('!space:mindroom.chat', '#space:mindroom.chat'),
        makeRoom('!room:mindroom.chat', '#room:mindroom.chat'),
      ],
    });

    expect(
      canonicalizeSessionPathname(mx, '/%23space%3Amindroom.chat/%23room%3Amindroom.chat/')
    ).toBe('/!space%3Amindroom.chat/!room%3Amindroom.chat');
  });

  it('resolves unknown aliases through the homeserver before replacing the visible route', async () => {
    const mx = makeMatrixClient({
      resolvedAliases: {
        '#space:mindroom.chat': '!space:mindroom.chat',
        '#room:mindroom.chat': '!room:mindroom.chat',
      },
    });

    await expect(
      resolveCanonicalizedPathname(mx, '/%23space%3Amindroom.chat/%23room%3Amindroom.chat/')
    ).resolves.toBe('/!space%3Amindroom.chat/!room%3Amindroom.chat');

    expect(mx.getRoomIdForAlias).toHaveBeenCalledWith('#space:mindroom.chat');
    expect(mx.getRoomIdForAlias).toHaveBeenCalledWith('#room:mindroom.chat');
  });
});
