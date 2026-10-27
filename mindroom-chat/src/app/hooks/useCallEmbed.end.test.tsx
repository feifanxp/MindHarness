// @vitest-environment jsdom
import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';

// The real theme module imports generated styles that Vitest does not load.
vi.mock('./useTheme', () => ({
  ThemeKind: { Dark: 'dark', Light: 'light' },
  useTheme: () => ({ id: 'dark-theme', kind: 'dark', classNames: [] }),
}));

/* eslint-disable import/first */
import { CallEmbed, ElementWidgetActions } from '../plugins/call';
import { CALL_END_FALLBACK_MS, useCallEnd, useCallEndLifecycle } from './useCallEmbed';
import { callEmbedAtom } from '../state/callEmbed';
/* eslint-enable import/first */

type EndControl = {
  ending: boolean;
  endCall: () => void;
};

type FakeEmbed = {
  embed: CallEmbed;
  dispose: ReturnType<typeof vi.fn>;
  hangup: ReturnType<typeof vi.fn>;
  emit: (action: string) => void;
};

const makeEmbed = (hangup: () => Promise<unknown>): FakeEmbed => {
  const listeners = new Map<string, Set<(event: CustomEvent) => void>>();
  const dispose = vi.fn();
  const hangupMock = vi.fn(hangup);
  const call = {
    on: (type: string, listener: (event: CustomEvent) => void) => {
      const actionListeners = listeners.get(type) ?? new Set();
      actionListeners.add(listener);
      listeners.set(type, actionListeners);
    },
    off: (type: string, listener: (event: CustomEvent) => void) => {
      listeners.get(type)?.delete(listener);
    },
  };
  const embed = {
    roomId: '!call:mindroom.test',
    room: { roomId: '!call:mindroom.test' },
    call,
    hangup: hangupMock,
    dispose,
  } as unknown as CallEmbed;

  return {
    embed,
    dispose,
    hangup: hangupMock,
    emit: (action) => {
      listeners.get(`action:${action}`)?.forEach((listener) => listener({} as CustomEvent));
    },
  };
};

function EndHarness({
  embed,
  finish,
  requestHangup,
  onFirst,
  onSecond,
}: {
  embed: CallEmbed;
  finish: () => void;
  requestHangup: boolean;
  onFirst: (control: EndControl) => void;
  onSecond: (control: EndControl) => void;
}) {
  useCallEndLifecycle(embed, finish);
  const [firstEnding, firstEndCall] = useCallEnd(embed, requestHangup);
  const [secondEnding, secondEndCall] = useCallEnd(embed, requestHangup);
  onFirst({ ending: firstEnding, endCall: firstEndCall });
  onSecond({ ending: secondEnding, endCall: secondEndCall });
  return null;
}

describe('bounded call End fallback', () => {
  const renderers: ReactTestRenderer[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    renderers.splice(0).forEach((renderer) => {
      act(() => renderer.unmount());
    });
    vi.useRealTimers();
  });

  const renderEnd = (fake: FakeEmbed, requestHangup = true) => {
    const store = createStore();
    store.set(callEmbedAtom, fake.embed);
    let first!: EndControl;
    let second!: EndControl;
    const finish = vi.fn(() => {
      if (store.get(callEmbedAtom) === fake.embed) store.set(callEmbedAtom, undefined);
    });
    act(() => {
      renderers.push(
        create(
          <Provider store={store}>
            <EndHarness
              embed={fake.embed}
              finish={finish}
              requestHangup={requestHangup}
              onFirst={(control) => {
                first = control;
              }}
              onSecond={(control) => {
                second = control;
              }}
            />
          </Provider>
        )
      );
    });
    return { store, finish, first: () => first, second: () => second };
  };

  it('shares one request and forces local disposal at the deadline', async () => {
    const fake = makeEmbed(
      () =>
        new Promise(() => {
          // Models a wedged iframe whose widget request never settles.
        })
    );
    const harness = renderEnd(fake);

    await act(async () => {
      harness.first().endCall();
      await Promise.resolve();
    });
    expect(harness.first().ending).toBe(true);
    expect(harness.second().ending).toBe(true);
    harness.second().endCall();
    expect(fake.hangup).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(CALL_END_FALLBACK_MS - 1));
    expect(harness.store.get(callEmbedAtom)).toBe(fake.embed);
    act(() => vi.advanceTimersByTime(1));

    expect(harness.finish).toHaveBeenCalledTimes(1);
    expect(fake.dispose).toHaveBeenCalledTimes(1);
    expect(harness.store.get(callEmbedAtom)).toBeUndefined();
  });

  it('keeps the existing healthy widget completion path immediate', async () => {
    const fake = makeEmbed(async () => ({}));
    const harness = renderEnd(fake);

    await act(async () => {
      harness.first().endCall();
      await Promise.resolve();
    });
    act(() => fake.emit(ElementWidgetActions.Close));

    expect(harness.finish).toHaveBeenCalledTimes(1);
    expect(harness.store.get(callEmbedAtom)).toBeUndefined();
    act(() => vi.advanceTimersByTime(CALL_END_FALLBACK_MS));
    expect(harness.finish).toHaveBeenCalledTimes(1);
  });

  it('finishes a not-yet-joined call immediately without asking the widget', () => {
    const fake = makeEmbed(async () => ({}));
    const harness = renderEnd(fake, false);

    act(() => harness.first().endCall());

    expect(fake.hangup).not.toHaveBeenCalled();
    expect(harness.finish).toHaveBeenCalledTimes(1);
    expect(harness.store.get(callEmbedAtom)).toBeUndefined();
  });

  it('consumes a rejected widget request and still uses the deadline', async () => {
    const fake = makeEmbed(async () => {
      throw new Error('Transport stopped');
    });
    const harness = renderEnd(fake);

    await act(async () => {
      harness.first().endCall();
      await Promise.resolve();
    });
    expect(harness.store.get(callEmbedAtom)).toBe(fake.embed);

    act(() => vi.advanceTimersByTime(CALL_END_FALLBACK_MS));
    expect(harness.finish).toHaveBeenCalledTimes(1);
    expect(harness.store.get(callEmbedAtom)).toBeUndefined();
  });

  it('cancels the old deadline when another embed replaces the call', async () => {
    const fake = makeEmbed(
      () =>
        new Promise(() => {
          // Models an old iframe still wedged while a new embed replaces it.
        })
    );
    const replacement = makeEmbed(async () => ({}));
    const harness = renderEnd(fake);

    await act(async () => {
      harness.first().endCall();
      await Promise.resolve();
    });
    act(() => harness.store.set(callEmbedAtom, replacement.embed));
    act(() => vi.advanceTimersByTime(CALL_END_FALLBACK_MS));

    expect(harness.finish).not.toHaveBeenCalled();
    expect(harness.store.get(callEmbedAtom)).toBe(replacement.embed);
  });
});
