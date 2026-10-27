// @vitest-environment jsdom
import React, { StrictMode, useEffect } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, Root } from 'react-dom/client';
import { ClientEvent, createClient, Device, MatrixEvent, Room, SyncState } from 'matrix-js-sdk';
import type { CryptoApi } from 'matrix-js-sdk/lib/crypto-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { disposeModelController, getModelController } from './modelController';
import { ModelPickerState, useModelControllerLifetime, useModelPicker } from './useModelPicker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const flush = async () => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
};
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const setup = () => {
  vi.useFakeTimers();
  const viewer = '@viewer:test';
  const router = '@mindroom_router:test';
  const mx = createClient({ baseUrl: 'https://test', userId: viewer });
  const sync = vi.spyOn(mx, 'getSyncState').mockReturnValue(SyncState.Syncing);
  const room = new Room('!room:test', mx, viewer);
  [viewer, router, '@mindroom_helper:test'].forEach((id) =>
    room.currentState.setStateEvents([
      new MatrixEvent({
        type: 'm.room.member',
        room_id: room.roomId,
        sender: id,
        state_key: id,
        content: { membership: 'join' },
      }),
    ])
  );
  const requests: any[] = [];
  vi.spyOn(mx, 'getCrypto').mockReturnValue({
    getUserDeviceInfo: async () =>
      new Map([
        [
          router,
          new Map([
            [
              'DEVICE',
              new Device({
                userId: router,
                deviceId: 'DEVICE',
                algorithms: [],
                keys: new Map([['curve25519:DEVICE', 'curve']]),
              }),
            ],
          ]),
        ],
      ]),
    getDeviceVerificationStatus: async () => ({ signedByOwner: true }),
    encryptToDeviceMessages: async (_type: string, recipients: object[], request: object) => {
      requests.push(request);
      return {
        eventType: 'm.room.encrypted',
        batch: recipients.map((r) => ({ ...r, payload: {} })),
      };
    },
  } as unknown as CryptoApi);
  vi.spyOn(mx, 'queueToDevice').mockResolvedValue();
  let state!: ModelPickerState;
  let mounts = 0;
  let releases = 0;
  function App() {
    useModelControllerLifetime();
    state = useModelPicker(room, '$root');
    useEffect(() => {
      mounts += 1;
      return () => {
        releases += 1;
      };
    }, []);
    return React.createElement('span', null, state.eligible ? 'available' : 'unavailable');
  }
  const node = document.createElement('div');
  document.body.append(node);
  let root: Root | undefined;
  const mount = async (strict = false) => {
    root = createRoot(node);
    await act(async () => {
      root!.render(
        React.createElement(
          MatrixClientProvider,
          { value: mx },
          strict
            ? React.createElement(StrictMode, null, React.createElement(App))
            : React.createElement(App)
        )
      );
      await flush();
    });
  };
  const unmount = () => {
    act(() => root?.unmount());
    root = undefined;
  };
  cleanups.push(() => {
    unmount();
    disposeModelController(mx);
    node.remove();
  });
  const discover = async () => {
    await act(async () => {
      mx.emit(ClientEvent.ReceivedToDeviceMessage, {
        message: {
          type: 'io.mindroom.models.response',
          sender: router,
          content: {
            ...requests[requests.length - 1],
            capabilities: ['model_selection'],
            agent_user_ids: ['@mindroom_helper:test'],
            catalog_revision: 'revision',
            models: [{ key: 'fast', provider: 'openai', id: 'model' }],
            selection: { override: null, inherited: [] },
          },
        },
        encryptionInfo: {
          sender: router,
          senderCurve25519KeyBase64: 'curve',
          senderVerified: false,
        },
      });
      await flush();
      await vi.advanceTimersByTimeAsync(12000);
    });
  };
  return {
    mx,
    sync,
    room,
    requests,
    mount,
    unmount,
    discover,
    state: () => state,
    node,
    counts: () => ({ mounts, releases }),
  };
};

describe('model controller lifecycle ownership', () => {
  it('keeps snapshot reads inert before a client lifetime or subscription starts', () => {
    const h = setup();
    const controller = getModelController(h.mx);
    controller.getSnapshot(h.room, '$root');
    expect(h.mx.listenerCount(ClientEvent.ReceivedToDeviceMessage)).toBe(0);
  });
  it('keeps stopped hooks on one inert owner and explicitly restarts it on client remount', async () => {
    const h = setup();
    await h.mount();
    await h.discover();
    const owner = getModelController(h.mx);
    expect(h.state().eligible).toBe(true);
    await act(async () => {
      h.sync.mockReturnValue(SyncState.Stopped);
      h.mx.emit(ClientEvent.Sync, SyncState.Stopped, SyncState.Syncing);
      await flush();
    });
    expect(h.mx.listenerCount(ClientEvent.ReceivedToDeviceMessage)).toBe(0);
    expect(getModelController(h.mx)).toBe(owner);
    expect(h.state().eligible).toBe(false);
    const count = h.requests.length;
    await act(async () => {
      h.state().refresh();
      await flush();
    });
    expect(h.requests).toHaveLength(count);
    h.unmount();
    h.sync.mockReturnValue(SyncState.Syncing);
    await h.mount();
    await h.discover();
    expect(getModelController(h.mx)).toBe(owner);
    expect(h.mx.listenerCount(ClientEvent.ReceivedToDeviceMessage)).toBe(1);
    expect(h.state().eligible).toBe(true);
    expect(h.node.textContent).toBe('available');
  });
  it('keeps live subscriptions after actual StrictMode effect cleanup and replay', async () => {
    const h = setup();
    const owner = getModelController(h.mx);
    await h.mount(true);
    expect(h.counts()).toEqual({ mounts: 2, releases: 1 });
    await h.discover();
    expect(getModelController(h.mx)).toBe(owner);
    expect(h.mx.listenerCount(ClientEvent.ReceivedToDeviceMessage)).toBe(1);
    expect(h.state().eligible).toBe(true);
    expect(h.node.textContent).toBe('available');
    h.unmount();
    expect(h.mx.listenerCount(ClientEvent.ReceivedToDeviceMessage)).toBe(0);
  });
});
