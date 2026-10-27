import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoomAutomaticFill, useRoomAutomaticFill } from './roomAutomaticFill';

afterEach(() => vi.unstubAllGlobals());

describe('classic automatic fill lifecycle', () => {
  it('reveals the measured initial window while background history is still pending', () => {
    const checks: (() => void)[] = [];
    let pending = true;
    let reveals = 0;
    let requests = 0;
    const options = {
      readGeometry: () => 'mounted-window-ready',
      schedule: (check: () => void) => {
        checks.push(check);
      },
      onInitialGeometryReady: () => {
        reveals += 1;
      },
      isPaginationPending: () => pending,
    };
    const owner = createRoomAutomaticFill(options);
    owner.defer(() => {
      requests += 1;
      return true;
    });
    checks.shift()?.();
    checks.shift()?.();
    expect(reveals).toBe(1);
    checks.shift()?.();
    checks.shift()?.();
    expect(requests).toBe(0);
    pending = false;
    checks.shift()?.();
    checks.shift()?.();
    expect(requests).toBe(1);
  });

  it('reveals measured initial rows before authorizing the first backward fill', () => {
    const checks: (() => void)[] = [];
    let reveals = 0;
    let requests = 0;
    const options = {
      readGeometry: () => 'measured-zero-debt',
      schedule: (check: () => void) => {
        checks.push(check);
      },
      onInitialGeometryReady: () => {
        reveals += 1;
      },
    };
    const owner = createRoomAutomaticFill(options);
    owner.defer(() => {
      requests += 1;
      return true;
    });
    checks.shift()?.();
    checks.shift()?.();
    expect(reveals).toBe(1);
    expect(requests).toBe(0);
    checks.shift()?.();
    checks.shift()?.();
    expect(requests).toBe(1);
    checks.shift()?.();
    checks.shift()?.();
    expect(reveals).toBe(1);
  });

  it('widens the local range after remote prepend leaves the mounted tail unchanged', () => {
    const frames: FrameRequestCallback[] = [];
    const tasks: (() => void)[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('setTimeout', (callback: () => void) => {
      tasks.push(callback);
      return tasks.length;
    });
    let busy = false;
    let requests = 0;
    let owner: ReturnType<typeof useRoomAutomaticFill>;
    const root = {
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as HTMLElement;
    const getScrollElement = () => root;
    const Harness = ({ contentKey }: { contentKey: string }) => {
      owner = useRoomAutomaticFill({
        viewKey: 'room',
        enabled: true,
        latestEventId: 'latest',
        getScrollElement,
        isPaginating: () => busy,
        ...{ contentKey },
      });
      owner.geometryReader.current = () => 'same-eight-measured-tail-rows';
      return null;
    };
    const frame = () =>
      act(() => {
        frames.shift()?.(0);
        tasks.shift()?.();
      });
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(Harness, { contentKey: '0:8:8' }));
    });
    owner!.defer(() => {
      requests += 1;
      busy = true;
      return true;
    });
    frame();
    frame();
    expect(owner!.hideInitialRows).toBe(false);
    expect(requests).toBe(0);
    frame();
    frame();
    expect(requests).toBe(1);
    frame();
    busy = false;
    act(() => {
      renderer.update(React.createElement(Harness, { contentKey: '200:208:208' }));
    });
    frame();
    frame();
    expect(requests).toBe(2);
    expect(owner!.hideInitialRows).toBe(false);
    act(() => renderer.unmount());
    vi.unstubAllGlobals();
  });

  it.each(['gesture', 'navigation', 'new-latest'])(
    'does not strand hidden rows on %s',
    (reason) => {
      vi.stubGlobal('requestAnimationFrame', () => 1);
      let owner: ReturnType<typeof useRoomAutomaticFill>;
      const getScrollElement = () => null;
      const Harness = ({
        enabled = true,
        latestEventId = 'latest',
      }: {
        enabled?: boolean;
        latestEventId?: string;
      }) => {
        owner = useRoomAutomaticFill({
          viewKey: 'room',
          enabled,
          latestEventId,
          contentKey: '0:8:8',
          getScrollElement,
          isPaginating: () => false,
        });
        return null;
      };
      let renderer: ReturnType<typeof create>;
      act(() => {
        renderer = create(React.createElement(Harness));
      });
      expect(owner!.hideInitialRows).toBe(true);
      act(() => {
        if (reason === 'gesture') owner.cancel();
        else
          renderer.update(
            React.createElement(
              Harness,
              reason === 'navigation' ? { enabled: false } : { latestEventId: 'new-latest' }
            )
          );
      });
      expect(owner!.hideInitialRows).toBe(false);
      expect(owner!.isActive()).toBe(false);
      act(() => renderer.unmount());
    }
  );

  it('resumes effect replay without letting obsolete checks end initial fill', () => {
    const checks: (() => void)[] = [];
    let requests = 0;
    const owner = createRoomAutomaticFill({
      schedule: (check) => {
        checks.push(check);
      },
      readGeometry: () => 'empty',
    });
    owner.defer(() => {
      requests += 1;
      return false;
    });
    owner.pause();
    owner.resume();
    checks.shift()?.();
    expect(owner.isActive()).toBe(true);
    checks.shift()?.();
    expect(requests).toBe(0);
    checks.shift()?.();
    expect(requests).toBe(1);
  });

  it('waits through settlement and subsequent mounted measurements before retrying', () => {
    const checks: (() => void)[] = [];
    let geometry: string | undefined;
    let requests = 0;
    const owner = createRoomAutomaticFill({
      schedule: (check) => {
        checks.push(check);
      },
      readGeometry: () => geometry,
    });
    owner.defer(() => {
      requests += 1;
      return false;
    });
    checks.shift()?.();
    expect(requests).toBe(0);
    geometry = 'settled';
    checks.shift()?.();
    geometry = undefined; // Post-settle ResizeObserver opened fresh debt.
    checks.shift()?.();
    expect(owner.isActive()).toBe(true);
    geometry = 'measured';
    checks.shift()?.();
    expect(requests).toBe(0);
    checks.shift()?.();
    expect(requests).toBe(1);
    expect(owner.isActive()).toBe(false);
  });

  it('hands pagination to genuine intent and ignores stale queued checks', () => {
    const checks: (() => void)[] = [];
    let requests = 0;
    const owner = createRoomAutomaticFill({
      schedule: (check) => {
        checks.push(check);
      },
      readGeometry: () => undefined,
    });
    owner.defer(() => {
      requests += 1;
      return true;
    });
    owner.cancel(true);
    checks.shift()?.();
    expect(requests).toBe(1);
    expect(owner.isActive()).toBe(false);
  });
});
