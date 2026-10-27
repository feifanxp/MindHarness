import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { createClient, ClientEvent, Device, MatrixEvent, Room } from 'matrix-js-sdk';
import type { CryptoApi } from 'matrix-js-sdk/lib/crypto-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { useModelPicker, useModelControllerLifetime, ModelPickerState } from './useModelPicker';

let renderer: ReactTestRenderer | undefined;
const flush = async () => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
};
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
});
describe('model picker hook ownership', () => {
  it('shares one client owner, switches scope cleanly, and tears down at client lifetime end', async () => {
    vi.useFakeTimers();
    const userId = '@viewer:test';
    const router = '@mindroom_router:test';
    const mx = createClient({ baseUrl: 'https://test', userId });
    const room = new Room('!room:test', mx, userId);
    [userId, router, '@mindroom_helper:test'].forEach((id) =>
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
      encryptToDeviceMessages: async (_type: string, devices: object[], payload: object) => {
        requests.push(payload);
        return {
          eventType: 'm.room.encrypted',
          batch: devices.map((d) => ({ ...d, payload: {} })),
        };
      },
    } as unknown as CryptoApi);
    vi.spyOn(mx, 'queueToDevice').mockResolvedValue();
    let state: ModelPickerState;
    function Picker({ thread }: { thread?: string }) {
      state = useModelPicker(room, thread);
      return null;
    }
    function Lifetime({ thread }: { thread?: string }) {
      useModelControllerLifetime();
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(Picker, { thread }),
        React.createElement(Picker, { thread })
      );
    }
    const render = (thread?: string) =>
      React.createElement(
        MatrixClientProvider,
        { value: mx },
        React.createElement(Lifetime, { thread })
      );
    await act(async () => {
      renderer = create(render('$first'));
      await flush();
    });
    expect(requests).toHaveLength(1);
    expect(mx.listenerCount(ClientEvent.ReceivedToDeviceMessage)).toBe(1);
    const reply = (request: any) =>
      mx.emit(ClientEvent.ReceivedToDeviceMessage, {
        message: {
          type: 'io.mindroom.models.response',
          sender: router,
          content: {
            ...request,
            capabilities: ['model_selection'],
            agent_user_ids: ['@mindroom_helper:test'],
            catalog_revision: 'rev',
            models: [{ key: 'fast', provider: 'openai', id: 'model' }],
            selection: { override: null, inherited: [] },
          },
        },
        encryptionInfo: {
          sender: router,
          senderVerified: false,
          senderCurve25519KeyBase64: 'curve',
        },
      });
    await act(async () => {
      renderer!.update(render('$second'));
      await flush();
      reply(requests[0]);
      await flush();
      await vi.advanceTimersByTimeAsync(12000);
    });
    expect(state!.eligible).toBe(false);
    await act(async () => {
      state!.refresh();
      await flush();
      reply(requests[requests.length - 1]);
      await flush();
      await vi.advanceTimersByTimeAsync(12000);
    });
    expect(state!.eligible).toBe(true);
    expect(state!.models[0].key).toBe('fast');
    await act(async () => {
      renderer!.update(render());
      await flush();
    });
    expect(state!.eligible).toBe(false);
    act(() => renderer!.unmount());
    renderer = undefined;
    expect(mx.listenerCount(ClientEvent.ReceivedToDeviceMessage)).toBe(0);
    await act(async () => {
      renderer = create(render('$third'));
      await flush();
    });
    expect(mx.listenerCount(ClientEvent.ReceivedToDeviceMessage)).toBe(1);
    expect(state!.eligible).toBe(false);
  });
});
