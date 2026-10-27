import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { SCHEDULER_WAKEUP_REPLACED_EVENT } from './mindroom/diagnostics/schedulerWakeup';

type SchedulerCallback = () => SchedulerCallback | void;

type Scheduler = {
  unstable_NormalPriority: number;
  unstable_scheduleCallback: (priority: number, callback: SchedulerCallback) => unknown;
};

type HostChannel = { closed: boolean; severed: boolean };

const require = createRequire(import.meta.url);

/**
 * Evaluates a shipped React Scheduler build against a deterministic browser host.
 * WebKit brokers MessagePorts through its networking process; when that process
 * exits it discards queued port messages and stops delivering on every existing
 * port without an event, while ports created afterwards work. `severPorts`
 * reproduces that loss. `timersFirst` models WebKit running an overdue timer
 * before an already queued port message.
 */
const createSchedulerHost = (
  build: string,
  {
    timersFirst = false,
    closeDropsQueued = true,
    dispatch = 'record' as 'record' | 'missing' | 'throw',
  } = {}
) => {
  let now = 0;
  let nextTimerId = 1;
  let failNextChannel = false;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const messageTasks: Array<{ channel: HostChannel; run: () => void }> = [];
  const channels: HostChannel[] = [];
  const errors: unknown[] = [];
  const replacements: unknown[] = [];

  class HostMessageChannel {
    port1: { onmessage: (() => void) | null; close: () => void };

    port2: { postMessage: (data: unknown) => void; close: () => void };

    constructor() {
      if (failNextChannel) {
        failNextChannel = false;
        throw new Error('MessageChannel unavailable');
      }
      const channel: HostChannel = { closed: false, severed: false };
      channels.push(channel);
      const close = () => {
        channel.closed = true;
      };
      this.port1 = { onmessage: null, close };
      this.port2 = {
        close,
        postMessage: () => {
          if (channel.closed || channel.severed) return;
          messageTasks.push({ channel, run: () => this.port1.onmessage?.() });
        },
      };
    }
  }

  class HostCustomEvent {
    constructor(readonly type: string, readonly init?: { detail?: unknown }) {}
  }

  const runTask = (task: () => void) => {
    try {
      task();
    } catch (error) {
      // Browsers report an uncaught task error and keep running the event loop.
      errors.push(error);
    }
  };
  const takeDueTimer = () => {
    const due = [...timers.entries()]
      .filter(([, timer]) => timer.at <= now)
      .sort(([leftId, left], [rightId, right]) => left.at - right.at || leftId - rightId)[0];
    if (!due) return undefined;
    timers.delete(due[0]);
    return due[1];
  };
  const takeMessage = () => {
    for (;;) {
      const message = messageTasks.shift();
      if (!message) return undefined;
      if (message.channel.severed) continue;
      if (!message.channel.closed || !closeDropsQueued) return message;
    }
  };
  /** Runs every task that is runnable at the current time, in event-loop order. */
  const drain = () => {
    for (;;) {
      const timer = timersFirst ? takeDueTimer() : undefined;
      if (timer) {
        runTask(timer.callback);
      } else {
        const message = takeMessage();
        if (message) {
          runTask(message.run);
        } else {
          const lateTimer = takeDueTimer();
          if (!lateTimer) return;
          runTask(lateTimer.callback);
        }
      }
    }
  };
  /** Moves the clock forward, running timers as they come due. */
  const advance = (ms: number, { deliver = true } = {}) => {
    const target = now + ms;
    for (;;) {
      const next = [...timers.values()].reduce<number | undefined>(
        (earliest, timer) =>
          timer.at <= target && (earliest === undefined || timer.at < earliest)
            ? timer.at
            : earliest,
        undefined
      );
      if (next === undefined) break;
      now = next;
      if (deliver) {
        drain();
      } else {
        const timer = takeDueTimer();
        if (timer) runTask(timer.callback);
      }
    }
    now = target;
    if (deliver) drain();
  };

  const eventApi =
    dispatch === 'missing'
      ? {}
      : {
          CustomEvent: HostCustomEvent,
          dispatchEvent: (event: HostCustomEvent) => {
            if (dispatch === 'throw') throw new Error('listener failed');
            if (event.type === SCHEDULER_WAKEUP_REPLACED_EVENT) {
              replacements.push(event.init?.detail);
            }
            return true;
          },
        };
  const context = {
    exports: {} as Scheduler,
    process: { env: { NODE_ENV: build.includes('production') ? 'production' : 'development' } },
    console,
    Date,
    MessageChannel: HostMessageChannel,
    ...eventApi,
    performance: { now: () => now },
    setTimeout: (callback: () => void, delay = 0) => {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, { at: now + Math.max(0, delay), callback });
      return id;
    },
    clearTimeout: (id: number) => {
      timers.delete(id);
    },
  };
  const sandbox = vm.createContext(context);
  const buildPath = require.resolve(build);
  // Evaluate the build's relative CommonJS dependencies in the same host.
  const requireInHost = (specifier: string) => {
    const path = createRequire(buildPath).resolve(specifier);
    const module = { exports: {} };
    const factory = vm.runInContext(
      `(function (exports, require, module) {${readFileSync(path, 'utf8')}\n})`,
      sandbox
    ) as (exports: unknown, require: unknown, module: unknown) => void;
    factory(module.exports, requireInHost, module);
    return module.exports;
  };
  vm.runInContext(`(function (exports, require) {${readFileSync(buildPath, 'utf8')}\n})`, sandbox)(
    context.exports,
    requireInHost
  );

  return {
    scheduler: context.exports,
    advance,
    drain,
    /** Advances the clock inside a running task, as a long task would. */
    elapse: (ms: number) => {
      now += ms;
    },
    deliverOneMessage: () => {
      const message = takeMessage();
      if (message) runTask(message.run);
    },
    channelCount: () => channels.length,
    openChannelCount: () => channels.filter((channel) => !channel.closed).length,
    errors,
    failNextChannel: () => {
      failNextChannel = true;
    },
    pendingTimerCount: () => timers.size,
    replacements,
    severPorts: () => {
      channels.forEach((channel) => {
        channel.severed = true;
      });
    },
  };
};

const BUILDS = [
  'scheduler/cjs/scheduler.development.js',
  'scheduler/cjs/scheduler.production.min.js',
] as const;

describe.each(BUILDS)('React Scheduler MessagePort loss (%s)', (build) => {
  it('runs work queued behind a wakeup that WebKit discarded', () => {
    const host = createSchedulerHost(build);
    const { scheduler } = host;
    const ran: string[] = [];

    scheduler.unstable_scheduleCallback(scheduler.unstable_NormalPriority, () => {
      ran.push('before loss');
    });
    host.severPorts();
    host.drain();
    expect(ran).toEqual([]);

    host.advance(1000);
    expect(ran).toEqual(['before loss']);
    expect(host.replacements).toEqual([{ elapsedMs: 250 }]);
    expect(host.channelCount()).toBe(2);
    expect(host.openChannelCount()).toBe(1);

    scheduler.unstable_scheduleCallback(scheduler.unstable_NormalPriority, () => {
      ran.push('after recovery');
    });
    host.drain();
    expect(ran).toEqual(['before loss', 'after recovery']);
    expect(host.channelCount()).toBe(2);
  });

  it('recovers when the port dies while the message loop is idle', () => {
    const host = createSchedulerHost(build);
    const { scheduler } = host;
    const ran: string[] = [];

    scheduler.unstable_scheduleCallback(scheduler.unstable_NormalPriority, () => {
      ran.push('healthy');
    });
    host.drain();
    host.severPorts();

    scheduler.unstable_scheduleCallback(scheduler.unstable_NormalPriority, () => {
      ran.push('first after loss');
    });
    host.drain();
    expect(ran).toEqual(['healthy']);

    host.advance(1000);
    scheduler.unstable_scheduleCallback(scheduler.unstable_NormalPriority, () => {
      ran.push('second after loss');
    });
    host.drain();
    expect(ran).toEqual(['healthy', 'first after loss', 'second after loss']);
  });

  it('finishes a continuation when the port dies between work slices', () => {
    const host = createSchedulerHost(build);
    const { scheduler } = host;
    let slices = 0;
    const work: SchedulerCallback = () => {
      slices += 1;
      host.elapse(4);
      return slices < 10 ? work : undefined;
    };

    scheduler.unstable_scheduleCallback(scheduler.unstable_NormalPriority, work);
    host.deliverOneMessage();
    expect(slices).toBeGreaterThan(0);
    expect(slices).toBeLessThan(10);
    host.severPorts();

    host.advance(1000);
    expect(slices).toBe(10);
  });

  it('keeps the message loop running after a scheduled callback throws', () => {
    const host = createSchedulerHost(build);
    const { scheduler } = host;
    const ran: string[] = [];

    scheduler.unstable_scheduleCallback(scheduler.unstable_NormalPriority, () => {
      throw new Error('render failed');
    });
    scheduler.unstable_scheduleCallback(scheduler.unstable_NormalPriority, () => {
      ran.push('after throw');
    });
    host.drain();

    expect(host.errors).toHaveLength(1);
    expect(ran).toEqual(['after throw']);
    expect(host.channelCount()).toBe(1);
    expect(host.replacements).toEqual([]);
  });

  it('retries replacement when creating a channel fails', () => {
    const host = createSchedulerHost(build);
    const { scheduler } = host;
    let runs = 0;

    host.severPorts();
    scheduler.unstable_scheduleCallback(scheduler.unstable_NormalPriority, () => {
      runs += 1;
    });
    host.failNextChannel();

    host.advance(1000);
    expect(host.errors).toHaveLength(1);
    expect(runs).toBe(1);
  });

  it.each([false, true])(
    'keeps one channel through continuous work longer than the grace period (timers first: %s)',
    (timersFirst) => {
      const host = createSchedulerHost(build, { timersFirst });
      const { scheduler } = host;
      let slices = 0;
      const work: SchedulerCallback = () => {
        slices += 1;
        host.elapse(4);
        return slices < 400 ? work : undefined;
      };

      scheduler.unstable_scheduleCallback(scheduler.unstable_NormalPriority, work);
      host.drain();
      host.advance(1000);

      expect(slices).toBe(400);
      expect(host.channelCount()).toBe(1);
      expect(host.replacements).toEqual([]);
      expect(host.pendingTimerCount()).toBe(0);
    }
  );

  it('keeps one port and no idle timer while wakeups arrive', () => {
    const host = createSchedulerHost(build);
    const { scheduler } = host;
    let runs = 0;

    for (let index = 0; index < 50; index += 1) {
      scheduler.unstable_scheduleCallback(scheduler.unstable_NormalPriority, () => {
        runs += 1;
      });
      host.drain();
      host.advance(10);
    }
    host.advance(1000);

    expect(runs).toBe(50);
    expect(host.channelCount()).toBe(1);
    expect(host.pendingTimerCount()).toBe(0);
  });

  it.each([false, true])(
    'closes a channel replaced after a long task and runs its work once (timers first: %s)',
    (timersFirst) => {
      const host = createSchedulerHost(build, { timersFirst });
      const { scheduler } = host;
      let runs = 0;

      scheduler.unstable_scheduleCallback(scheduler.unstable_NormalPriority, () => {
        runs += 1;
      });
      // A long task holds the original delivery past the replacement timeout.
      host.elapse(400);
      host.drain();

      expect(runs).toBe(1);
      expect(host.openChannelCount()).toBe(1);
      expect(host.channelCount()).toBe(timersFirst ? 2 : 1);

      scheduler.unstable_scheduleCallback(scheduler.unstable_NormalPriority, () => {
        runs += 1;
      });
      host.drain();
      expect(runs).toBe(2);
      expect(host.openChannelCount()).toBe(1);
    }
  );

  it('runs work once when a closed channel still delivers its queued wakeup', () => {
    const host = createSchedulerHost(build, { timersFirst: true, closeDropsQueued: false });
    const { scheduler } = host;
    let runs = 0;

    scheduler.unstable_scheduleCallback(scheduler.unstable_NormalPriority, () => {
      runs += 1;
    });
    host.elapse(400);
    host.drain();
    expect(runs).toBe(1);
    expect(host.channelCount()).toBe(2);

    scheduler.unstable_scheduleCallback(scheduler.unstable_NormalPriority, () => {
      runs += 1;
    });
    host.drain();
    host.advance(1000);
    expect(runs).toBe(2);
    expect(host.channelCount()).toBe(2);
    expect(host.pendingTimerCount()).toBe(0);
  });

  it.each(['missing', 'throw'] as const)(
    'recovers when the replacement notification is unavailable (%s)',
    (dispatch) => {
      const host = createSchedulerHost(build, { dispatch });
      const { scheduler } = host;
      let runs = 0;

      scheduler.unstable_scheduleCallback(scheduler.unstable_NormalPriority, () => {
        runs += 1;
      });
      host.severPorts();
      host.advance(1000);

      expect(runs).toBe(1);
      expect(host.errors).toEqual([]);
    }
  );
});
