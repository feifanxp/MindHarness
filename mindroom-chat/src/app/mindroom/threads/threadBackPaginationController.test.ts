import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import type { ThreadPaginationRequest } from './session/threadSessionTypes';
import {
  useThreadBackPaginationController,
  type ThreadBackPaginationController,
} from './threadBackPaginationController';

const request: ThreadPaginationRequest = {
  lease: { roomId: '!room:test', threadId: '$thread', generation: 0 },
  direction: 'backward',
  requestId: 1,
};

type HarnessProps = {
  onRender: (controller: ThreadBackPaginationController) => void;
};

function Harness({ onRender }: HarnessProps) {
  onRender(useThreadBackPaginationController());
  return null;
}

const renderController = (): {
  getController: () => ThreadBackPaginationController;
  renderer: ReactTestRenderer;
} => {
  let controller: ThreadBackPaginationController | undefined;
  let renderer: ReactTestRenderer | undefined;

  act(() => {
    renderer = create(
      React.createElement(Harness, {
        onRender: (nextController) => {
          controller = nextController;
        },
      })
    );
  });

  return {
    getController: () => controller as ThreadBackPaginationController,
    renderer: renderer as ReactTestRenderer,
  };
};

describe('useThreadBackPaginationController', () => {
  it('begins back pagination by taking over from the opening pin', () => {
    const { getController, renderer } = renderController();

    act(() => {
      expect(getController().begin(request)).toBe(true);
    });

    expect(getController().owns(request)).toBe(true);
    expect(getController().isOpenBottomPinSuppressed()).toBe(true);

    renderer.unmount();
  });

  it('cancels the latest opening pin while preserving a newer explicit command', () => {
    const { getController, renderer } = renderController();
    const scrollToBottomRef = { current: { count: 4, smooth: true } };

    expect(getController().requestOpenBottomPin(scrollToBottomRef)).toBe(true);
    expect(scrollToBottomRef.current).toEqual({ count: 5, smooth: false });
    getController().cancelOpenBottomPin(scrollToBottomRef.current.count);
    expect(getController().shouldApplyBottomPin(5)).toBe(false);

    scrollToBottomRef.current = { count: 6, smooth: true };
    expect(getController().shouldApplyBottomPin(6)).toBe(true);

    renderer.unmount();
  });

  it('clears canceled opening provenance with route reset', () => {
    const { getController, renderer } = renderController();
    const scrollToBottomRef = { current: { count: 1, smooth: false } };

    getController().requestOpenBottomPin(scrollToBottomRef);
    getController().cancelOpenBottomPin(scrollToBottomRef.current.count);
    expect(getController().shouldApplyBottomPin(2)).toBe(false);

    getController().reset();
    expect(getController().shouldApplyBottomPin(2)).toBe(true);
    expect(getController().isOpenBottomPinSuppressed()).toBe(false);

    renderer.unmount();
  });
});

describe('backward request fencing', () => {
  it('refuses a second begin while a request owns back pagination', () => {
    const { getController, renderer } = renderController();
    getController().begin(request);
    expect(getController().begin({ ...request, requestId: 2 })).toBe(false);
    expect(getController().owns(request)).toBe(true);
    renderer.unmount();
  });
  it('an old finish cannot release a replacement request with a reused thread ID', () => {
    const { getController, renderer } = renderController();
    getController().begin(request);
    getController().reset();
    const next = { ...request, requestId: 2, lease: { ...request.lease, generation: 2 } };
    getController().begin(next);
    getController().finish(request);
    expect(getController().owns(next)).toBe(true);
    renderer.unmount();
  });
  it('finish releases back pagination for the next begin', () => {
    const { getController, renderer } = renderController();
    getController().begin(request);
    getController().finish(request);
    expect(getController().owns(request)).toBe(false);
    expect(getController().begin({ ...request, requestId: 2 })).toBe(true);
    renderer.unmount();
  });
});
