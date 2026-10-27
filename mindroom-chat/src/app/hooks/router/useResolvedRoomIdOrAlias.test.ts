import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMatrixClient } from '../useMatrixClient';
import { useResolvedRoomIdOrAlias } from './useResolvedRoomIdOrAlias';

const getCanonicalAliasRoomId = vi.hoisted(() => vi.fn());

vi.mock('../useMatrixClient', () => ({
  useMatrixClient: vi.fn(),
}));

vi.mock('../../utils/matrix', () => ({
  getCanonicalAliasRoomId,
  isRoomAlias: (id: string) => id.startsWith('#'),
}));

type RenderedResolution = {
  input: string | undefined;
  isResolvingAlias: boolean;
  roomId: string | undefined;
};

type ProbeProps = {
  onRender: (resolution: RenderedResolution) => void;
  roomIdOrAlias?: string;
};

function Probe({ onRender, roomIdOrAlias }: ProbeProps) {
  const resolution = useResolvedRoomIdOrAlias(roomIdOrAlias);
  onRender({
    input: roomIdOrAlias,
    isResolvingAlias: resolution.isResolvingAlias,
    roomId: resolution.roomId,
  });
  return null;
}

describe('useResolvedRoomIdOrAlias', () => {
  const mx = {
    getRoomIdForAlias: vi.fn(),
  };

  beforeEach(() => {
    vi.mocked(useMatrixClient).mockReturnValue(mx as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not expose the previous room while a new alias route is being resolved synchronously', async () => {
    const renders: RenderedResolution[] = [];
    getCanonicalAliasRoomId.mockImplementation((_mx, alias: string) =>
      alias === '#new:example.org' ? '!new:example.org' : undefined
    );

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(Probe, {
          roomIdOrAlias: '!old:example.org',
          onRender: (resolution) => renders.push(resolution),
        })
      );
    });

    renders.length = 0;
    await act(async () => {
      renderer!.update(
        React.createElement(Probe, {
          roomIdOrAlias: '#new:example.org',
          onRender: (resolution) => renders.push(resolution),
        })
      );
    });

    expect(renders).not.toContainEqual({
      input: '#new:example.org',
      isResolvingAlias: false,
      roomId: '!old:example.org',
    });
    expect(renders.at(-1)).toEqual({
      input: '#new:example.org',
      isResolvingAlias: false,
      roomId: '!new:example.org',
    });
  });

  it('does not expose the previous room while a new alias route awaits homeserver resolution', async () => {
    const renders: RenderedResolution[] = [];
    let resolveAlias: (value: { room_id: string }) => void = () => undefined;

    getCanonicalAliasRoomId.mockReturnValue(undefined);
    mx.getRoomIdForAlias.mockImplementation(
      () =>
        new Promise<{ room_id: string }>((resolve) => {
          resolveAlias = resolve;
        })
    );

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(Probe, {
          roomIdOrAlias: '!old:example.org',
          onRender: (resolution) => renders.push(resolution),
        })
      );
    });

    renders.length = 0;
    await act(async () => {
      renderer!.update(
        React.createElement(Probe, {
          roomIdOrAlias: '#unknown:example.org',
          onRender: (resolution) => renders.push(resolution),
        })
      );
    });

    expect(renders).not.toContainEqual({
      input: '#unknown:example.org',
      isResolvingAlias: false,
      roomId: '!old:example.org',
    });
    expect(renders[0]).toEqual({
      input: '#unknown:example.org',
      isResolvingAlias: true,
      roomId: undefined,
    });

    await act(async () => {
      resolveAlias({ room_id: '!unknown:example.org' });
      await Promise.resolve();
    });

    expect(renders.at(-1)).toEqual({
      input: '#unknown:example.org',
      isResolvingAlias: false,
      roomId: '!unknown:example.org',
    });
  });
});
