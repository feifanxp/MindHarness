// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { observeThreadRenderScheduler } from './threadRenderSchedulerProbe';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('distinguishes a delayed message channel from timer and animation callbacks', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  let deliver: (() => void) | undefined;
  vi.stubGlobal(
    'MessageChannel',
    class {
      port1 = { onmessage: undefined as (() => void) | undefined, close: () => undefined };

      port2 = {
        postMessage: () => {
          deliver = () => this.port1.onmessage?.();
        },
        close: () => undefined,
      };
    }
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16)
  );
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  const samples: Array<{ source: number; delayMs: number }> = [];
  const dispose = observeThreadRenderScheduler((sample) => samples.push(sample));
  vi.advanceTimersByTime(50);
  expect(samples).toMatchObject([
    { source: 1, delayMs: 0 },
    { source: 2, delayMs: 16 },
  ]);
  deliver?.();
  expect(samples[2]).toMatchObject({ source: 3, delayMs: 50 });
  dispose();
  deliver?.();
  expect(samples).toHaveLength(3);
  expect(vi.getTimerCount()).toBe(0);
});

it('cancels pending probes and tolerates an unavailable message channel', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16)
  );
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.stubGlobal(
    'MessageChannel',
    class {
      constructor() {
        throw new Error('Channel unavailable');
      }
    }
  );
  const samples: unknown[] = [];
  const dispose = observeThreadRenderScheduler((sample) => samples.push(sample));
  dispose();
  vi.runAllTimers();
  expect(samples).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});
