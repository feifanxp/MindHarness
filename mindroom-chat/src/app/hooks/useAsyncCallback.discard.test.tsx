import React, { useEffect } from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { revokeBlobUrl, useBlobUrlCleanup } from './useBlobUrlCleanup';
import { AsyncCallback, AsyncDiscardCallback, useAsyncCallback } from './useAsyncCallback';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

type ProbeProps = {
  request: AsyncCallback<[number], string>;
  onDiscard: AsyncDiscardCallback<string>;
  exposeLoad: (load: AsyncCallback<[number], string>) => void;
};

function AsyncCallbackProbe({ request, onDiscard, exposeLoad }: ProbeProps) {
  const [state, load] = useAsyncCallback(request, onDiscard);
  useBlobUrlCleanup(state);

  useEffect(() => {
    exposeLoad(load);
  }, [exposeLoad, load]);

  return null;
}

describe('useAsyncCallback discarded result ownership', () => {
  const outstandingUrls = new Set<string>();
  let nextObjectUrl = 0;

  beforeEach(() => {
    nextObjectUrl = 0;
    outstandingUrls.clear();
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const objectUrl = `blob:async-discard-${nextObjectUrl}`;
      nextObjectUrl += 1;
      outstandingUrls.add(objectUrl);
      return objectUrl;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((objectUrl) => {
      outstandingUrls.delete(objectUrl);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('revokes blob results discarded after replacement and unmount', async () => {
    const requests = [createDeferred<void>(), createDeferred<void>()];
    const request = vi.fn(async (requestIndex: number) => {
      await requests[requestIndex].promise;
      return URL.createObjectURL(new Blob([String(requestIndex)]));
    });
    let load!: AsyncCallback<[number], string>;
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <AsyncCallbackProbe
          request={request}
          onDiscard={revokeBlobUrl}
          exposeLoad={(nextLoad) => {
            load = nextLoad;
          }}
        />
      );
    });

    let replacedRequest!: Promise<string>;
    let unmountedRequest!: Promise<string>;
    await act(async () => {
      replacedRequest = load(0);
      unmountedRequest = load(1);
      await Promise.resolve();
    });

    requests[0].resolve();
    await expect(replacedRequest).rejects.toThrow('AsyncCallbackHook: Request replaced!');
    expect(outstandingUrls).toHaveLength(0);

    act(() => {
      renderer.unmount();
    });
    requests[1].resolve();
    await expect(unmountedRequest).resolves.toBe('blob:async-discard-1');
    expect(outstandingUrls).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('revokes a resolved blob when unmounted before its queued publication', async () => {
    const request = vi.fn(async (requestIndex: number) =>
      URL.createObjectURL(new Blob([String(requestIndex)]))
    );
    let load!: AsyncCallback<[number], string>;
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <AsyncCallbackProbe
          request={request}
          onDiscard={revokeBlobUrl}
          exposeLoad={(nextLoad) => {
            load = nextLoad;
          }}
        />
      );
    });

    let resolvedRequest!: Promise<string>;
    act(() => {
      resolvedRequest = load(0);
      queueMicrotask(() => {
        act(() => {
          renderer.unmount();
        });
      });
    });
    await act(async () => {
      await resolvedRequest;
    });

    await expect(resolvedRequest).resolves.toBe('blob:async-discard-0');
    expect(outstandingUrls).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it('revokes and rejects a resolved blob replaced before its queued publication', async () => {
    const request = vi.fn(async (requestIndex: number) =>
      URL.createObjectURL(new Blob([String(requestIndex)]))
    );
    let load!: AsyncCallback<[number], string>;
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <AsyncCallbackProbe
          request={request}
          onDiscard={revokeBlobUrl}
          exposeLoad={(nextLoad) => {
            load = nextLoad;
          }}
        />
      );
    });

    let firstRequest!: Promise<string>;
    let replacementRequest!: Promise<string>;
    await act(async () => {
      firstRequest = load(0);
      queueMicrotask(() => {
        replacementRequest = load(1);
      });
      await expect(firstRequest).rejects.toThrow('AsyncCallbackHook: Request replaced!');
      await Promise.resolve();
    });

    await expect(replacementRequest).resolves.toBe('blob:async-discard-1');
    act(() => {
      renderer.unmount();
    });

    expect(outstandingUrls).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});
