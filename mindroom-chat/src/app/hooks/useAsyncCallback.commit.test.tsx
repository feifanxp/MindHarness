// @vitest-environment jsdom

import React, { useLayoutEffect, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { revokeBlobUrl, useBlobUrlCleanup } from './useBlobUrlCleanup';
import { AsyncCallback, useAsyncCallback } from './useAsyncCallback';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Controller = {
  load: AsyncCallback<[], string>;
  hide: () => void;
};

type ProbeProps = {
  exposeLoad: (load: AsyncCallback<[], string>) => void;
};

function DisposableProbe({ exposeLoad }: ProbeProps) {
  const [state, load] = useAsyncCallback(
    async () => URL.createObjectURL(new Blob(['media'])),
    revokeBlobUrl
  );
  useBlobUrlCleanup(state);

  useLayoutEffect(() => {
    exposeLoad(load);
  }, [exposeLoad, load]);

  return null;
}

function Harness({ controller }: { controller: Controller }) {
  const [visible, setVisible] = useState(true);

  controller.hide = () => setVisible(false);

  return visible ? (
    <DisposableProbe
      exposeLoad={(load) => {
        controller.load = load;
      }}
    />
  ) : null;
}

describe('useAsyncCallback commit ownership', () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: Controller;
  const outstandingUrls = new Set<string>();
  let nextObjectUrl = 0;
  const createObjectURL = vi.fn();
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    controller = {
      load: async () => {
        throw new Error('Probe has not committed');
      },
      hide: () => undefined,
    };
    outstandingUrls.clear();
    nextObjectUrl = 0;
    createObjectURL.mockReset();
    createObjectURL.mockImplementation(() => {
      const objectUrl = `blob:commit-ownership-${nextObjectUrl}`;
      nextObjectUrl += 1;
      outstandingUrls.add(objectUrl);
      return objectUrl;
    });
    revokeObjectURL.mockReset();
    revokeObjectURL.mockImplementation((objectUrl) => {
      outstandingUrls.delete(objectUrl);
    });
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL,
    });

    act(() => {
      root.render(<Harness controller={controller} />);
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  const startThenBatchBeforeCommit = (parentUpdate: () => void): Promise<string> => {
    let request!: Promise<string>;

    act(() => {
      request = controller.load();
      queueMicrotask(() => {
        queueMicrotask(parentUpdate);
      });
    });

    return request;
  };

  const flushConcurrentWork = async (): Promise<void> => {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  };

  it('disposes once when a parent unmount batches away the queued success', async () => {
    const requestOutcome = expect(startThenBatchBeforeCommit(controller.hide)).resolves.toBe(
      'blob:commit-ownership-0'
    );
    await flushConcurrentWork();
    await requestOutcome;

    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(outstandingUrls).toHaveLength(0);
  });

  it('disposes once and rejects when a request replacement batches away the queued success', async () => {
    let replacementRequest!: Promise<string>;
    const firstRequest = startThenBatchBeforeCommit(() => {
      replacementRequest = controller.load();
    });
    const firstOutcome = expect(firstRequest).rejects.toThrow(
      'AsyncCallbackHook: Request replaced!'
    );

    await flushConcurrentWork();
    await firstOutcome;
    await expect(replacementRequest).resolves.toBe('blob:commit-ownership-1');
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(outstandingUrls).toEqual(new Set(['blob:commit-ownership-1']));
  });
});
