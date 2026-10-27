import {
  createClient,
  Device,
  MatrixEvent,
  MatrixEventEvent,
  MatrixScheduler,
  Room,
  ClientEvent,
  RoomMemberEvent,
  RoomEvent,
  SyncState,
} from 'matrix-js-sdk';
import type { CryptoBackend } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { CryptoEvent, type CryptoApi } from 'matrix-js-sdk/lib/crypto-api';
import { logger } from 'matrix-js-sdk/lib/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getModelController, disposeModelController } from './modelController';

const viewer = '@viewer:test';
const router = '@mindroom_router:test';
const helper = '@mindroom_helper:test';
beforeEach(() => {
  // Expected SDK offline/retry logs are not application failures.
  vi.spyOn(logger, 'debug').mockImplementation(() => {});
  vi.spyOn(logger, 'log').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
const cleanups: (() => void)[] = [];
const flush = async () => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
};
const setup = (lazyLoadMembers = false) => {
  vi.useFakeTimers();
  const mx = createClient({
    baseUrl: 'https://test',
    userId: viewer,
    deviceId: 'LOCAL',
    scheduler: new MatrixScheduler(() => -1),
  });
  const room = new Room('!room:test', mx, viewer, { lazyLoadMembers });
  const member = (userId: string, membership = 'join') => {
    room.currentState.setStateEvents([
      new MatrixEvent({
        type: 'm.room.member',
        room_id: room.roomId,
        sender: userId,
        state_key: userId,
        content: { membership },
      }),
    ]);
  };
  [viewer, ...(lazyLoadMembers ? [] : [router, helper])].forEach((id) => member(id));
  vi.spyOn(mx, 'getRoom').mockImplementation((id) => (id === room.roomId ? room : null));
  const device = (userId = router, deviceId = 'DEVICE', key = 'curve') =>
    new Device({
      userId,
      deviceId,
      algorithms: ['m.olm.v1.curve25519-aes-sha2'],
      keys: new Map([['curve25519:' + deviceId, key]]),
    });
  const devices = new Map([[router, new Map([['DEVICE', device()]])]]);
  const crypto = {
    getUserDeviceInfo: vi.fn(async () => devices),
    getDeviceVerificationStatus: vi.fn(async () => ({ signedByOwner: true })),
    encryptToDeviceMessages: vi.fn(async (_type, recipients, content) => ({
      eventType: 'm.room.encrypted',
      batch: recipients.map((r: object) => ({ ...r, payload: { encrypted: content } })),
    })),
  };
  vi.spyOn(mx, 'getCrypto').mockReturnValue(crypto as unknown as CryptoApi);
  const queued: any[] = [];
  const queue = vi.spyOn(mx, 'queueToDevice').mockImplementation(async (batch) => {
    queued.push(batch);
  });
  const send = vi.spyOn(mx, 'sendMessage').mockResolvedValue({ event_id: '$command' });
  const controller = getModelController(mx);
  cleanups.push(() => disposeModelController(mx));
  const snapshot = (thread = '$root') => controller.getSnapshot(room, thread);
  const response = (request: any, changes: any = {}, identity: any = {}) => {
    mx.emit(ClientEvent.ReceivedToDeviceMessage, {
      message: {
        type: 'io.mindroom.models.response',
        sender: router,
        content: {
          version: 1,
          request_id: request.request_id,
          room_id: request.room_id,
          ...(request.thread_id ? { thread_id: request.thread_id } : {}),
          capabilities: ['model_selection'],
          agent_user_ids: [helper],
          catalog_revision: 'revision',
          models: [
            { key: 'fast', display_name: 'Quick', provider: 'openai', id: 'model' },
            { key: 'reset', display_name: 'Reset model', provider: 'openai', id: 'model2' },
          ],
          selection: { override: null, inherited: [{ entity: 'helper', model: 'fast' }] },
          ...changes,
        },
      },
      encryptionInfo:
        identity === null
          ? null
          : {
              sender: router,
              senderDevice: 'FORGED',
              senderVerified: false,
              senderCurve25519KeyBase64: 'curve',
              ...identity,
            },
    });
  };
  const request = () => queued[queued.length - 1].batch[0].payload.encrypted;
  const discover = async () => {
    const unsubscribe = controller.subscribe(room, '$root', () => {});
    await flush();
    response(request());
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    return unsubscribe;
  };
  const ack = (changes: any = {}, eventChanges: any = {}) => {
    const event = new MatrixEvent({
      event_id: '$ack',
      type: 'm.room.message',
      sender: router,
      room_id: room.roomId,
      content: {
        msgtype: 'm.notice',
        body: 'Model selected',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
        'io.mindroom.model_selection_result': {
          version: 1,
          command_event_id: '$command',
          room_id: room.roomId,
          thread_id: '$root',
          runtime_user_id: router,
          runtime_device_id: 'DEVICE',
          operation: 'set',
          model: 'fast',
          status: 'applied',
          override: 'fast',
          ...changes,
        },
      },
      ...eventChanges,
    });
    mx.emit(ClientEvent.Event, event);
    return event;
  };
  return {
    mx,
    room,
    member,
    device,
    devices,
    crypto,
    queue,
    queued,
    send,
    controller,
    snapshot,
    response,
    request,
    discover,
    ack,
  };
};
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('shared model discovery', () => {
  it('hydrates lazy room membership before considering discovery candidates', async () => {
    const h = setup(true);
    vi.spyOn(h.mx, 'members').mockResolvedValue({
      chunk: [viewer, router, helper].map((id) => ({
        type: 'm.room.member',
        room_id: h.room.roomId,
        sender: id,
        state_key: id,
        content: { membership: 'join' },
      })),
    });
    h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    expect(h.queue).toHaveBeenCalledTimes(1);
    h.response(h.request());
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot().eligible).toBe(true);
  });
  it('rediscovers for active subscribers after device invalidation', async () => {
    const h = setup();
    await h.discover();
    const oldCount = h.queued.length;
    h.mx.emit(CryptoEvent.DevicesUpdated, [router]);
    expect(h.snapshot().eligible).toBe(false);
    await flush();
    expect(h.queued.length).toBeGreaterThan(oldCount);
    h.response(h.request());
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot().eligible).toBe(true);
  });
  it('coalesces subscribers and authenticates actual curve key before exposing capability', async () => {
    const h = setup();
    const a = h.controller.subscribe(h.room, '$root', () => {});
    const b = h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    expect(h.queue).toHaveBeenCalledTimes(1);
    expect(h.snapshot().eligible).toBe(false);
    h.response(h.request());
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot().eligible).toBe(true);
    expect(h.snapshot().runtime).toMatchObject({
      userId: router,
      deviceId: 'DEVICE',
      curveKey: 'curve',
    });
    expect(h.crypto.getUserDeviceInfo).toHaveBeenCalledWith(expect.arrayContaining([router]), true);
    a();
    b();
  });
  it('reuses room capability across threads without copying another thread selection', async () => {
    const h = setup();
    await h.discover();
    h.controller.selectModel(h.room, '$root', 'fast');
    await flush();
    h.ack();
    await flush();
    h.controller.subscribe(h.room, '$second', () => {});
    await flush();
    expect(h.snapshot('$second').eligible).toBe(true);
    expect(h.snapshot('$second').override).toBeNull();
    expect(h.snapshot('$second').runtime).toBeUndefined();
    expect(h.snapshot('$second').loading).toBe(true);
    h.controller.selectModel(h.room, '$second', 'fast');
    await flush();
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it('registers listener before a synchronous transport response', async () => {
    const h = setup();
    h.queue.mockImplementation(async (batch: any) => {
      h.response(batch.batch[0].payload.encrypted);
    });
    h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot().eligible).toBe(true);
  });
  it.each(['invite', 'leave', 'foreign', 'self-left'])(
    'does not probe ineligible candidate rooms: %s',
    async (kind) => {
      const h = setup();
      h.member(router, 'leave');
      h.member(helper, 'leave');
      if (kind === 'foreign') h.member('@mindroom_router:elsewhere');
      else if (kind === 'self-left') {
        h.member(router);
        h.member(viewer, 'leave');
      } else h.member(router, kind);
      h.controller.subscribe(h.room, '$root', () => {});
      await flush();
      expect(h.queue).not.toHaveBeenCalled();
      expect(h.snapshot().eligible).toBe(false);
    }
  );
  it.each([
    'plaintext',
    'curve',
    'sender',
    'unsigned',
    'rotated',
    'room',
    'thread',
    'request',
    'router-only',
    'left-agent',
    'invited-agent',
    'foreign-agent',
  ])('rejects untrusted or mismatched reply: %s', async (kind) => {
    const h = setup();
    h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    const changes: any = {};
    const identity: any = {};
    if (kind === 'curve') identity.senderCurve25519KeyBase64 = 'unknown';
    if (kind === 'sender') identity.sender = '@stranger:test';
    if (kind === 'unsigned')
      h.crypto.getDeviceVerificationStatus.mockResolvedValue({ signedByOwner: false });
    if (kind === 'rotated')
      h.devices.get(router)!.set('DEVICE', h.device(router, 'DEVICE', 'new-key'));
    if (kind === 'room') changes.room_id = '!elsewhere:test';
    if (kind === 'thread') changes.thread_id = '$other';
    if (kind === 'request') changes.request_id = 'old';
    if (kind === 'router-only') changes.agent_user_ids = [router];
    if (kind === 'left-agent') h.member(helper, 'leave');
    if (kind === 'invited-agent') h.member(helper, 'invite');
    if (kind === 'foreign-agent') {
      h.member('@mindroom_helper:elsewhere');
      changes.agent_user_ids = ['@mindroom_helper:elsewhere'];
    }
    h.response(h.request(), changes, kind === 'plaintext' ? null : identity);
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot().eligible).toBe(false);
  });
  it('requires explicit choice between authenticated runtime devices', async () => {
    const h = setup();
    h.devices.get(router)!.set('SECOND', h.device(router, 'SECOND', 'curve2'));
    h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    h.response(h.request());
    h.response(h.request(), {}, { senderCurve25519KeyBase64: 'curve2' });
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot().runtimes).toHaveLength(2);
    expect(h.snapshot().runtime).toBeUndefined();
    h.controller.chooseRuntime(h.room, '$root', h.snapshot().runtimes[1].id);
    expect(h.snapshot().runtime?.deviceId).toBe('SECOND');
  });
  it('does not silently retain an automatic choice when a second runtime appears', async () => {
    const h = setup();
    await h.discover();
    h.devices.get(router)!.set('SECOND', h.device(router, 'SECOND', 'curve2'));
    h.controller.refresh(h.room, '$root');
    await flush();
    h.response(h.request());
    h.response(h.request(), {}, { senderCurve25519KeyBase64: 'curve2' });
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot().runtime).toBeUndefined();
  });
  it('keeps controllers isolated per client and removes listeners on logout', async () => {
    const h = setup();
    await h.discover();
    const other = setup();
    expect(other.snapshot().eligible).toBe(false);
    expect(getModelController(h.mx)).toBe(h.controller);
    h.mx.emit(ClientEvent.Sync, SyncState.Stopped, SyncState.Syncing);
    expect(h.snapshot().eligible).toBe(false);
    expect(h.mx.listenerCount(ClientEvent.ReceivedToDeviceMessage)).toBe(0);
  });
  it.each(['logout', 'device change'])(
    'clears evicted thread room catalogs on %s',
    async (cause) => {
      const h = setup();
      const leave = await h.discover();
      leave();
      for (let index = 0; index < 65; index += 1) {
        h.controller.getSnapshot(new Room('!cache' + index + ':test', h.mx, viewer), '$root');
      }
      if (cause === 'logout') disposeModelController(h.mx);
      else h.mx.emit(CryptoEvent.DevicesUpdated, [router]);
      expect(h.snapshot().eligible).toBe(false);
    }
  );
  it('expires in 12 seconds and ignores late navigation and disposal replies', async () => {
    const h = setup();
    const leave = h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    const request = h.request();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot().loading).toBe(false);
    h.response(request);
    await flush();
    expect(h.snapshot().eligible).toBe(false);
    h.controller.refresh(h.room, '$root');
    await flush();
    const next = h.request();
    leave();
    h.response(next);
    await flush();
    expect(h.snapshot().eligible).toBe(false);
    disposeModelController(h.mx);
    h.response(next);
    await flush();
    expect(h.snapshot().eligible).toBe(false);
  });
  it('invalidates membership and device changes immediately', async () => {
    const h = setup();
    await h.discover();
    h.member(helper, 'leave');
    h.mx.emit(RoomMemberEvent.Membership, new MatrixEvent({}), h.room.getMember(helper)!);
    expect(h.snapshot().eligible).toBe(false);
    h.member(helper);
    h.controller.refresh(h.room, '$root');
    await flush();
    h.response(h.request());
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    h.mx.emit(CryptoEvent.DevicesUpdated, [router]);
    expect(h.snapshot().eligible).toBe(false);
  });
  it('retries omitted encrypted recipients without dropping or widening target set', async () => {
    const h = setup();
    h.devices.get(router)!.set('SECOND', h.device(router, 'SECOND', 'curve2'));
    let omitted = false;
    h.crypto.encryptToDeviceMessages.mockImplementation(async (_type, recipients, content) => ({
      eventType: 'm.room.encrypted',
      batch: recipients
        .filter((recipient: { deviceId: string }) => {
          if (recipient.deviceId !== 'SECOND' || omitted) return true;
          omitted = true;
          return false;
        })
        .map((recipient: object) => ({ ...recipient, payload: { encrypted: content } })),
    }));
    h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    await vi.advanceTimersByTimeAsync(500);
    expect(h.queued.flatMap((batch) => batch.batch.map((r: any) => r.deviceId))).toEqual([
      'DEVICE',
      'SECOND',
    ]);
  });
  it('shows the model picker after discovery succeeds beside a stale signed device', async () => {
    const h = setup();
    h.devices.get(router)!.set('STALE', h.device(router, 'STALE', 'stale-curve'));
    h.crypto.encryptToDeviceMessages.mockImplementation(async (_type, recipients, content) => {
      if (recipients.some((recipient: { deviceId: string }) => recipient.deviceId === 'STALE')) {
        throw new Error('Device has no Olm session');
      }
      return {
        eventType: 'm.room.encrypted',
        batch: recipients.map((recipient: object) => ({
          ...recipient,
          payload: { encrypted: content },
        })),
      };
    });
    h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    expect(h.queued).toHaveLength(1);
    h.response(h.request());
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot().eligible).toBe(true);
    expect(h.snapshot().canMutate).toBe(true);
  });
  it('retransmits unanswered discovery with the same request ID and stops after authenticated response', async () => {
    const h = setup();
    h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    const first = h.request();
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.queued).toHaveLength(2);
    expect(h.request()).toEqual(first);
    h.response(h.request());
    await flush();
    await vi.advanceTimersByTimeAsync(10000);
    expect(h.queued).toHaveLength(2);
    expect(h.snapshot().eligible).toBe(true);
  });
});

describe('model mutation acknowledgement', () => {
  it('exposes recovery-blocked mutation availability after a settled send loses its acknowledgement', async () => {
    const h = setup();
    await h.discover();
    expect(h.snapshot().canMutate).toBe(true);
    h.controller.refresh(h.room, '$root');
    await flush();
    expect(h.snapshot().canMutate).toBe(true);
    h.controller.selectModel(h.room, '$root', 'fast');
    await flush();
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.snapshot().canMutate).toBe(false);
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot().pending).toBe(false);
    expect(h.snapshot().loading).toBe(true);
    expect(h.snapshot().canMutate).toBe(false);
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot().pending).toBe(false);
    expect(h.snapshot().loading).toBe(false);
    expect(h.snapshot().error).toBeDefined();
    expect(h.snapshot().canMutate).toBe(false);
    h.controller.selectModel(h.room, '$root', 'fast');
    h.controller.resetToRoomDefault(h.room, '$root');
    await flush();
    expect(h.send).toHaveBeenCalledTimes(1);
    h.controller.refresh(h.room, '$root');
    await flush();
    h.response(h.request());
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot().canMutate).toBe(true);
    h.controller.resetToRoomDefault(h.room, '$root');
    await flush();
    expect(h.send).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['timeout', 'resolve'],
    ['timeout', 'reject'],
    ['device invalidation', 'resolve'],
    ['device invalidation', 'reject'],
  ])(
    'retains unresolved SDK send ownership after %s until %s and fresh discovery',
    async (cause, settlement) => {
      const h = setup();
      await h.discover();
      let resolve!: (value: { event_id: string }) => void;
      let reject!: (error: Error) => void;
      h.send.mockImplementationOnce(
        () =>
          new Promise((done, fail) => {
            resolve = done;
            reject = fail;
          })
      );
      h.controller.selectModel(h.room, '$root', 'fast');
      await flush();
      const initialRequestId = h.request().request_id;
      if (cause === 'timeout') await vi.advanceTimersByTimeAsync(12000);
      else {
        h.mx.emit(CryptoEvent.DevicesUpdated, [router]);
        await flush();
      }
      expect(h.request().request_id).not.toBe(initialRequestId);
      h.response(h.request(), { selection: { override: 'reset', inherited: [] } });
      await flush();
      await vi.advanceTimersByTimeAsync(12000);
      expect(h.snapshot().override).toBe('reset');
      expect(h.snapshot().loading).toBe(false);
      h.controller.resetToRoomDefault(h.room, '$root');
      await flush();
      expect(h.send).toHaveBeenCalledTimes(1);
      expect(h.snapshot().pending).toBe(true);
      const requestBeforeSettlement = h.request().request_id;
      if (settlement === 'resolve') resolve({ event_id: '$command' });
      else reject(new Error('transport failed'));
      await flush();
      expect(h.snapshot().loading).toBe(true);
      expect(h.request().request_id).not.toBe(requestBeforeSettlement);
      h.controller.resetToRoomDefault(h.room, '$root');
      await flush();
      expect(h.send).toHaveBeenCalledTimes(1);
      h.response(h.request(), { selection: { override: 'fast', inherited: [] } });
      await flush();
      await vi.advanceTimersByTimeAsync(12000);
      expect(h.snapshot().override).toBe('fast');
      expect(h.snapshot().pending).toBe(false);
      h.controller.resetToRoomDefault(h.room, '$root');
      await flush();
      expect(h.send).toHaveBeenCalledTimes(2);
    }
  );
  it('retains the transport barrier through client remount and inactive cache eviction', async () => {
    const h = setup();
    const leave = await h.discover();
    let resolve!: (value: { event_id: string }) => void;
    h.send.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    h.controller.selectModel(h.room, '$root', 'fast');
    await flush();
    leave();
    h.mx.emit(ClientEvent.Sync, SyncState.Stopped, SyncState.Syncing);
    const release = h.controller.retain();
    for (let index = 0; index < 65; index += 1) {
      h.controller.getSnapshot(new Room('!cache' + index + ':test', h.mx, viewer), '$root');
    }
    h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    const beforeSettlement = h.request();
    resolve({ event_id: '$command' });
    await flush();
    const afterSettlement = h.request();
    expect(afterSettlement.request_id).not.toBe(beforeSettlement.request_id);
    h.response(beforeSettlement);
    await flush();
    h.controller.resetToRoomDefault(h.room, '$root');
    await flush();
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.snapshot().pending).toBe(true);
    h.response(afterSettlement, { selection: { override: 'fast', inherited: [] } });
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot().override).toBe('fast');
    expect(h.snapshot().pending).toBe(false);
    h.controller.resetToRoomDefault(h.room, '$root');
    await flush();
    expect(h.send).toHaveBeenCalledTimes(2);
    release();
  });
  it.each(['valid', 'wrong-key', 'unsigned', 'plaintext'])(
    'authenticates encrypted room acknowledgement: %s',
    async (kind) => {
      const h = setup();
      h.room.currentState.setStateEvents([
        new MatrixEvent({
          type: 'm.room.encryption',
          room_id: h.room.roomId,
          state_key: '',
          content: { algorithm: 'm.megolm.v1.aes-sha2' },
        }),
      ]);
      expect(h.room.currentState.getStateEvents('m.room.encryption', '')).not.toBeNull();
      await h.discover();
      h.controller.selectModel(h.room, '$root', 'fast');
      await flush();
      const clear = h.ack();
      await flush();
      if (kind !== 'plaintext') {
        const encrypted = new MatrixEvent({
          event_id: '$encrypted-ack',
          type: 'm.room.encrypted',
          sender: router,
          room_id: h.room.roomId,
          content: {
            algorithm: 'm.megolm.v1.aes-sha2',
            ciphertext: 'ciphertext',
            session_id: 'session',
            'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
          },
        });
        await encrypted.attemptDecryption({
          decryptEvent: async () => ({
            clearEvent: {
              type: 'm.room.message',
              room_id: h.room.roomId,
              content: clear.getContent(),
            },
            senderCurve25519Key: kind === 'wrong-key' ? 'other' : 'curve',
            claimedEd25519Key: 'edkey',
          }),
        } as CryptoBackend);
        expect(encrypted.getType()).toBe('m.room.message');
        expect(encrypted.getRelation()?.event_id).toBe('$root');
        if (kind === 'unsigned')
          h.crypto.getDeviceVerificationStatus.mockResolvedValue({ signedByOwner: false });
        h.mx.emit(MatrixEventEvent.Decrypted, encrypted);
        await flush();
      }
      expect(h.snapshot().override).toBe(kind === 'valid' ? 'fast' : null);
      expect(h.snapshot().pending).toBe(kind !== 'valid');
    }
  );
  it('does not send the command again after its send fails', async () => {
    const h = setup();
    await h.discover();
    h.send.mockRestore();
    // A synced client re-emits room local echo updates; the old fallback resent from those.
    h.mx.reEmitter.reEmit(h.room, [RoomEvent.LocalEchoUpdated]);
    const sends: string[] = [];
    vi.spyOn(h.mx.http, 'authedRequest').mockImplementation(async (_method, path) => {
      if (path.includes('/send/')) sends.push(path);
      throw new Error('offline');
    });
    h.controller.selectModel(h.room, '$root', 'fast');
    await flush();
    await flush();
    expect(sends).toHaveLength(1);
    expect(h.snapshot().error).toBe('Model selection unconfirmed. Refresh before trying again.');
  });
  it('sends reset without a model key and applies only a confirmed null override', async () => {
    const h = setup();
    await h.discover();
    h.controller.selectModel(h.room, '$root', 'fast');
    await flush();
    h.ack();
    await flush();
    h.controller.resetToRoomDefault(h.room, '$root');
    await flush();
    expect(h.send.mock.calls[1][2]['io.mindroom.model_selection']).toEqual({
      version: 1,
      runtime_user_id: router,
      runtime_device_id: 'DEVICE',
      operation: 'reset',
    });
    expect(h.snapshot().override).toBe('fast');
    h.ack({ operation: 'reset', model: undefined, override: null });
    await flush();
    expect(h.snapshot().override).toBeNull();
  });
  it('reports rejection without changing confirmed selection', async () => {
    const h = setup();
    await h.discover();
    h.controller.selectModel(h.room, '$root', 'fast');
    await flush();
    h.ack({ status: 'rejected', override: undefined, error: 'Selection denied' });
    await flush();
    expect(h.snapshot().pending).toBe(false);
    expect(h.snapshot().error).toBe('Selection denied');
    expect(h.snapshot().override).toBeNull();
  });
  it('sends stable key with exact thread/runtime metadata and waits for its own result', async () => {
    const h = setup();
    await h.discover();
    h.controller.selectModel(h.room, '$root', 'reset');
    await flush();
    expect(h.send).toHaveBeenCalledWith(
      '!room:test',
      '$root',
      expect.objectContaining({
        body: '!model reset',
        msgtype: 'm.text',
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: '$root',
          is_falling_back: true,
          'm.in_reply_to': { event_id: '$root' },
        },
        'io.mindroom.model_selection': {
          version: 1,
          runtime_user_id: router,
          runtime_device_id: 'DEVICE',
          operation: 'set',
          model: 'reset',
        },
      })
    );
    expect(h.snapshot().pending).toBe(true);
    expect(h.snapshot().override).toBeNull();
    h.ack({ model: 'reset', override: 'reset' });
    await flush();
    expect(h.snapshot().override).toBe('reset');
    expect(h.snapshot().pending).toBe(false);
  });
  it('buffers authenticated early acknowledgement until send yields event ID', async () => {
    const h = setup();
    await h.discover();
    let resolve!: (value: { event_id: string }) => void;
    h.send.mockImplementation(
      () =>
        new Promise((done) => {
          h.ack();
          resolve = done;
        })
    );
    h.controller.selectModel(h.room, '$root', 'fast');
    await flush();
    expect(h.snapshot().pending).toBe(true);
    resolve({ event_id: '$command' });
    await flush();
    expect(h.snapshot().override).toBe('fast');
  });
  it.each([
    { command_event_id: '$other' },
    { runtime_device_id: 'OTHER' },
    { thread_id: '$other' },
    { runtime_user_id: helper },
    { model: 'reset', override: 'reset' },
    { room_id: '!other:test' },
  ])('ignores mismatched acknowledgement %j', async (changes) => {
    const h = setup();
    await h.discover();
    h.controller.selectModel(h.room, '$root', 'fast');
    await flush();
    h.ack(changes);
    await flush();
    expect(h.snapshot().pending).toBe(true);
    expect(h.snapshot().override).toBeNull();
  });
  it('keeps pending through unmount, serializes mutations, and isolates other thread', async () => {
    const h = setup();
    const leave = await h.discover();
    h.controller.selectModel(h.room, '$root', 'fast');
    await flush();
    leave();
    h.controller.resetToRoomDefault(h.room, '$root');
    await flush();
    expect(h.send).toHaveBeenCalledTimes(1);
    h.ack();
    await flush();
    expect(h.snapshot().override).toBe('fast');
    expect(h.snapshot('$other').override).toBeNull();
  });
  it('refreshes after timeout and prevents older discovery replacing acknowledged selection', async () => {
    const h = setup();
    await h.discover();
    h.controller.refresh(h.room, '$root');
    await flush();
    const older = h.request();
    h.controller.selectModel(h.room, '$root', 'fast');
    await flush();
    h.ack();
    await flush();
    h.response(older);
    await flush();
    expect(h.snapshot().override).toBe('fast');
    h.controller.resetToRoomDefault(h.room, '$root');
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot().override).toBe('fast');
    expect(h.snapshot().pending).toBe(false);
    expect(h.snapshot().error).toBeDefined();
    expect(h.snapshot().loading).toBe(true);
  });
});
