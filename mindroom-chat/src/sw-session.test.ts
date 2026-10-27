import { afterEach, describe, expect, it, vi } from 'vitest';
import { pushSessionToSW, waitForServiceWorkerControl } from './sw-session';

type MockController = {
  postMessage: ReturnType<typeof vi.fn>;
};

type MockServiceWorkerContainer = EventTarget & {
  controller: MockController | null;
};

const createServiceWorkerContainer = (
  controller: MockController | null = null
): MockServiceWorkerContainer => {
  const serviceWorker = new EventTarget() as MockServiceWorkerContainer;
  serviceWorker.controller = controller;
  return serviceWorker;
};

describe('waitForServiceWorkerControl', () => {
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();

    if (originalNavigator === undefined) {
      Reflect.deleteProperty(globalThis, 'navigator');
    } else {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    }
  });

  it('resolves true immediately when a controller already exists', async () => {
    const serviceWorker = createServiceWorkerContainer({ postMessage: vi.fn() });
    const addEventListenerSpy = vi.spyOn(serviceWorker, 'addEventListener');

    Object.defineProperty(globalThis, 'navigator', {
      value: { serviceWorker },
      configurable: true,
    });

    await expect(waitForServiceWorkerControl()).resolves.toBe(true);
    expect(addEventListenerSpy).not.toHaveBeenCalled();
  });

  it('resolves true when controllerchange fires', async () => {
    const serviceWorker = createServiceWorkerContainer();

    Object.defineProperty(globalThis, 'navigator', {
      value: { serviceWorker },
      configurable: true,
    });

    const waitPromise = waitForServiceWorkerControl();

    serviceWorker.controller = { postMessage: vi.fn() };
    serviceWorker.dispatchEvent(new Event('controllerchange'));

    await expect(waitPromise).resolves.toBe(true);
  });

  it('resolves false after the timeout elapses', async () => {
    vi.useFakeTimers();

    const serviceWorker = createServiceWorkerContainer();

    Object.defineProperty(globalThis, 'navigator', {
      value: { serviceWorker },
      configurable: true,
    });

    const waitPromise = waitForServiceWorkerControl(3000);

    await vi.advanceTimersByTimeAsync(3000);

    await expect(waitPromise).resolves.toBe(false);
  });

  it('cleans up the controllerchange listener after resolving true', async () => {
    vi.useFakeTimers();

    const serviceWorker = createServiceWorkerContainer();
    const addEventListenerSpy = vi.spyOn(serviceWorker, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(serviceWorker, 'removeEventListener');

    Object.defineProperty(globalThis, 'navigator', {
      value: { serviceWorker },
      configurable: true,
    });

    const waitPromise = waitForServiceWorkerControl(3000);
    const controllerChangeListener = addEventListenerSpy.mock.calls[0]?.[1];

    serviceWorker.controller = { postMessage: vi.fn() };
    serviceWorker.dispatchEvent(new Event('controllerchange'));

    await expect(waitPromise).resolves.toBe(true);

    await vi.advanceTimersByTimeAsync(3000);

    expect(removeEventListenerSpy).toHaveBeenCalledTimes(1);
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'controllerchange',
      controllerChangeListener
    );
  });

  it('cleans up the controllerchange listener after timing out', async () => {
    vi.useFakeTimers();

    const serviceWorker = createServiceWorkerContainer();
    const addEventListenerSpy = vi.spyOn(serviceWorker, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(serviceWorker, 'removeEventListener');

    Object.defineProperty(globalThis, 'navigator', {
      value: { serviceWorker },
      configurable: true,
    });

    const waitPromise = waitForServiceWorkerControl(3000);
    const controllerChangeListener = addEventListenerSpy.mock.calls[0]?.[1];

    await vi.advanceTimersByTimeAsync(3000);

    await expect(waitPromise).resolves.toBe(false);

    expect(removeEventListenerSpy).toHaveBeenCalledTimes(1);
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'controllerchange',
      controllerChangeListener
    );
  });
});

describe('pushSessionToSW', () => {
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    vi.restoreAllMocks();

    if (originalNavigator === undefined) {
      Reflect.deleteProperty(globalThis, 'navigator');
    } else {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    }
  });

  it('is a no-op when no controller is present', () => {
    const serviceWorker = createServiceWorkerContainer();

    Object.defineProperty(globalThis, 'navigator', {
      value: { serviceWorker },
      configurable: true,
    });

    expect(() => pushSessionToSW('https://mindroom.chat', 'secret-token')).not.toThrow();
    expect(serviceWorker.controller).toBeNull();
  });
});
