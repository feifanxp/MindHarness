// @vitest-environment jsdom

import React, { useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { EventStatus, MatrixEvent, MatrixEventEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useLocalEchoStatus } from './useLocalEchoStatus';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const seen: Array<EventStatus | null | undefined> = [];

function Probe({ echo }: { echo?: MatrixEvent }) {
  seen.push(useLocalEchoStatus(echo));
  return null;
}

/** Fails the echo after render but before passive effects, where the subscription is made. */
function FailBeforeSubscribe({ echo }: { echo: MatrixEvent }) {
  useLayoutEffect(() => {
    echo.setStatus(EventStatus.NOT_SENT);
  }, [echo]);
  return null;
}

const localEcho = () => {
  const echo = new MatrixEvent({ type: 'm.room.message', content: {} });
  echo.setStatus(EventStatus.SENDING);
  return echo;
};

beforeEach(() => {
  container = document.createElement('div');
  root = createRoot(container);
  seen.length = 0;
});

afterEach(() => {
  act(() => root.unmount());
});

describe('useLocalEchoStatus', () => {
  it('follows every status change of the echo', () => {
    const echo = localEcho();
    act(() => root.render(<Probe echo={echo} />));
    act(() => echo.setStatus(EventStatus.SENT));
    act(() => echo.setStatus(null));
    expect(seen.at(-1)).toBeNull();
    expect(seen).toContain(EventStatus.SENT);
  });

  it('catches a change that happens before it subscribes', () => {
    const echo = localEcho();
    act(() =>
      root.render(
        <>
          <Probe echo={echo} />
          <FailBeforeSubscribe echo={echo} />
        </>
      )
    );
    expect(seen[0]).toBe(EventStatus.SENDING);
    expect(seen.at(-1)).toBe(EventStatus.NOT_SENT);
  });

  it('is undefined without an echo and stops listening when unmounted', () => {
    const echo = localEcho();
    act(() => root.render(<Probe />));
    expect(seen.at(-1)).toBeUndefined();
    act(() => root.render(<Probe echo={echo} />));
    expect(echo.listenerCount(MatrixEventEvent.Status)).toBe(1);
    act(() => root.render(<Probe />));
    expect(echo.listenerCount(MatrixEventEvent.Status)).toBe(0);
  });
});
