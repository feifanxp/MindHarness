import { EventEmitter } from 'events';
import { ClientEvent, MatrixEvent, MatrixEventEvent, RoomStateEvent } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CallEmbed } from './CallEmbed';

const warnings: Array<ReturnType<typeof vi.spyOn>> = [];

afterEach(() => {
  warnings.splice(0).forEach((warning) => warning.mockRestore());
});

const makeEvent = (): MatrixEvent =>
  ({
    getEffectiveEvent: () => ({ type: 'io.element.call.encryption_keys' }),
    isDecryptionFailure: () => false,
    isEncrypted: () => true,
  } as unknown as MatrixEvent);

const makeHarness = () => {
  const mx = Object.assign(new EventEmitter(), {
    getRooms: () => [],
    decryptEventIfNeeded: vi.fn(async () => undefined),
  });
  const call = Object.assign(new EventEmitter(), {
    setViewedRoomId: vi.fn(),
    stop: vi.fn(),
    feedToDevice: vi.fn(async () => undefined),
  });
  const driverDispose = vi.fn();
  const removeChild = vi.fn();
  const controlDispose = vi.fn();
  const iframe: { onload: null | (() => void) } = { onload: () => undefined };
  const embed = Object.create(CallEmbed.prototype) as CallEmbed;

  Object.assign(embed as unknown as Record<string, unknown>, {
    mx,
    call,
    room: { roomId: '!call:mindroom.test' },
    iframe,
    container: { removeChild },
    callWidgetDriver: { dispose: driverDispose },
    control: { dispose: controlDispose },
    disposables: [],
    readUpToMap: {},
    eventsToFeed: new WeakSet(),
    disposed: false,
  });

  return { embed, mx, call, driverDispose, removeChild, controlDispose, iframe };
};

const start = (embed: CallEmbed): void => (embed as unknown as { start: () => void }).start();

const feedToDevice = (embed: CallEmbed, event: MatrixEvent): Promise<void> =>
  (
    embed as unknown as {
      onToDeviceEvent: (matrixEvent: MatrixEvent) => Promise<void>;
    }
  ).onToDeviceEvent(event);

describe('CallEmbed disposal', () => {
  it('removes the exact Matrix listeners and is idempotent', () => {
    const h = makeHarness();
    start(h.embed);
    const events = [
      ClientEvent.Event,
      MatrixEventEvent.Decrypted,
      RoomStateEvent.Events,
      ClientEvent.ToDeviceEvent,
    ];
    events.forEach((event) => expect(h.mx.listenerCount(event)).toBe(1));

    h.embed.dispose();
    h.embed.dispose();

    events.forEach((event) => expect(h.mx.listenerCount(event)).toBe(0));
    expect(h.call.listenerCount('action:im.vector.join')).toBe(0);
    expect(h.driverDispose).toHaveBeenCalledOnce();
    expect(h.call.stop).toHaveBeenCalledOnce();
    expect(h.removeChild).toHaveBeenCalledOnce();
    expect(h.controlDispose).toHaveBeenCalledOnce();
    expect(h.iframe.onload).toBeNull();
  });

  it('attempts every teardown step after partial failures', () => {
    const h = makeHarness();
    const laterListener = vi.fn();
    Object.assign(h.embed as unknown as Record<string, unknown>, {
      disposables: [
        () => {
          throw new Error('listener failed');
        },
        laterListener,
      ],
    });
    h.driverDispose.mockImplementation(() => {
      throw new Error('driver failed');
    });
    h.removeChild.mockImplementation(() => {
      throw new Error('iframe already removed');
    });
    warnings.push(vi.spyOn(console, 'warn').mockImplementation(() => undefined));

    expect(() => h.embed.dispose()).not.toThrow();

    expect(laterListener).toHaveBeenCalledOnce();
    expect(h.call.stop).toHaveBeenCalledOnce();
    expect(h.controlDispose).toHaveBeenCalledOnce();
    expect(warnings[0]).toHaveBeenCalledTimes(3);
  });

  it('does not feed an event whose decryption completes after disposal', async () => {
    const h = makeHarness();
    let resolveDecrypt!: () => void;
    h.mx.decryptEventIfNeeded.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveDecrypt = resolve;
        })
    );
    const pendingFeed = feedToDevice(h.embed, makeEvent());

    h.embed.dispose();
    resolveDecrypt();
    await pendingFeed;

    expect(h.call.feedToDevice).not.toHaveBeenCalled();
  });

  it('consumes a live widget feed rejection', async () => {
    const h = makeHarness();
    h.call.feedToDevice.mockRejectedValueOnce(new Error('transport stopped'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(feedToDevice(h.embed, makeEvent())).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
