import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MatrixClient } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { AsyncStatus } from '../hooks/useAsyncCallback';
import { MatrixClientProvider } from '../hooks/useMatrixClient';
import { RoomSummaryLoader } from './RoomSummaryLoader';

const summary = {
  room_id: '!private:remote.example.org',
  name: 'Private room',
  join_rule: 'knock',
};

describe('RoomSummaryLoader', () => {
  it('reports loading, success, and a failed refetch while using federation hints', async () => {
    let resolveSummary: ((value: typeof summary) => void) | undefined;
    const getRoomSummary = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<typeof summary>((resolve) => {
            resolveSummary = resolve;
          })
      )
      .mockRejectedValueOnce(new Error('Summary unavailable'));
    const mx = { getRoomSummary } as unknown as MatrixClient;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const observedStatuses: AsyncStatus[] = [];
    let retrySummary: (() => void) | undefined;
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <MatrixClientProvider value={mx}>
            <RoomSummaryLoader
              roomIdOrAlias="!private:remote.example.org"
              viaServers={['one.example.org', 'two.example.org']}
            >
              {(state, retry) => {
                observedStatuses.push(state.status);
                retrySummary = retry;
                return <span>{state.status}</span>;
              }}
            </RoomSummaryLoader>
          </MatrixClientProvider>
        </QueryClientProvider>
      );
    });

    expect(observedStatuses.at(-1)).toBe(AsyncStatus.Loading);
    expect(getRoomSummary).toHaveBeenCalledWith('!private:remote.example.org', [
      'one.example.org',
      'two.example.org',
    ]);

    await act(async () => {
      resolveSummary?.(summary);
    });
    await act(async () => {
      await vi.waitFor(() => expect(observedStatuses.at(-1)).toBe(AsyncStatus.Success));
    });

    expect(observedStatuses.at(-1)).toBe(AsyncStatus.Success);
    act(() => retrySummary?.());
    await act(async () => {
      await vi.waitFor(() => expect(observedStatuses.at(-1)).toBe(AsyncStatus.Error));
    });

    act(() => renderer!.unmount());
    queryClient.clear();
  });

  it('resolves an alias and exposes its routing servers with the concrete summary', async () => {
    const servers = ['one.example.org', 'two.example.org'];
    const getRoomIdForAlias = vi.fn(async () => ({
      room_id: summary.room_id,
      servers,
    }));
    const getRoomSummary = vi.fn(async () => summary);
    const mx = { getRoomIdForAlias, getRoomSummary } as unknown as MatrixClient;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let observedServers: string[] | undefined;
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <MatrixClientProvider value={mx}>
            <RoomSummaryLoader roomIdOrAlias="#private:remote.example.org">
              {(_state, _retry, viaServers) => {
                observedServers = viaServers;
                return null;
              }}
            </RoomSummaryLoader>
          </MatrixClientProvider>
        </QueryClientProvider>
      );
    });

    await act(async () => {
      await vi.waitFor(() => expect(observedServers).toEqual(servers));
    });

    expect(getRoomIdForAlias).toHaveBeenCalledWith('#private:remote.example.org');
    expect(getRoomSummary).toHaveBeenCalledWith(summary.room_id, servers);
    act(() => renderer!.unmount());
    queryClient.clear();
  });

  it('preserves a verified alias target when summary discovery fails', async () => {
    const servers = ['one.example.org', 'two.example.org'];
    const getRoomIdForAlias = vi.fn(async () => ({
      room_id: summary.room_id,
      servers,
    }));
    const getRoomSummary = vi.fn(async () => {
      throw new Error('Summary unavailable');
    });
    const mx = { getRoomIdForAlias, getRoomSummary } as unknown as MatrixClient;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let observedStatus: AsyncStatus | undefined;
    let observedRoomId: string | undefined;
    let observedServers: string[] | undefined;
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <MatrixClientProvider value={mx}>
            <RoomSummaryLoader roomIdOrAlias="#private:remote.example.org">
              {(state, _retry, viaServers, roomId) => {
                observedStatus = state.status;
                observedRoomId = roomId;
                observedServers = viaServers;
                return null;
              }}
            </RoomSummaryLoader>
          </MatrixClientProvider>
        </QueryClientProvider>
      );
    });

    await act(async () => {
      await vi.waitFor(() => expect(observedStatus).toBe(AsyncStatus.Error));
    });

    expect(observedRoomId).toBe(summary.room_id);
    expect(observedServers).toEqual(servers);
    act(() => renderer!.unmount());
    queryClient.clear();
  });

  it('reports a failed discovery instead of exposing an unknown access rule', async () => {
    const getRoomSummary = vi.fn(async () => {
      throw new Error('Summary unavailable');
    });
    const mx = { getRoomSummary } as unknown as MatrixClient;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let observedStatus: AsyncStatus | undefined;
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <MatrixClientProvider value={mx}>
            <RoomSummaryLoader roomIdOrAlias="!private:remote.example.org">
              {(state) => {
                observedStatus = state.status;
                return null;
              }}
            </RoomSummaryLoader>
          </MatrixClientProvider>
        </QueryClientProvider>
      );
    });

    await act(async () => {
      await vi.waitFor(() => expect(observedStatus).toBe(AsyncStatus.Error));
    });

    expect(observedStatus).toBe(AsyncStatus.Error);
    act(() => renderer!.unmount());
    queryClient.clear();
  });
});
