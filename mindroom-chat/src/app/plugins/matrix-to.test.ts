// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { getMatrixToRoom, getMatrixToRoomEvent } from './matrix-to';

describe('matrix-to link helpers', () => {
  const originalBasePath = globalThis.__APP_BASE_PATH__;

  afterEach(() => {
    globalThis.__APP_BASE_PATH__ = originalBasePath;
    window.history.pushState({}, '', '/');
  });

  it('copies room links on the current app origin', () => {
    window.history.pushState({}, '', '/home/');

    expect(getMatrixToRoom('!room:mindroom.chat', ['mindroom.chat'])).toBe(
      `${window.location.origin}/!room:mindroom.chat?via=mindroom.chat`
    );
  });

  it('copies event links on the current app origin', () => {
    window.history.pushState({}, '', '/home/');

    expect(getMatrixToRoomEvent('!room:mindroom.chat', '$event', ['mindroom.chat'])).toBe(
      `${window.location.origin}/!room:mindroom.chat/$event?via=mindroom.chat`
    );
  });

  it('preserves deployments hosted under a base path', () => {
    globalThis.__APP_BASE_PATH__ = '/mindroom/';
    window.history.pushState({}, '', '/mindroom/home/');

    expect(getMatrixToRoomEvent('!room:example.com', '$event', ['example.com'])).toBe(
      `${window.location.origin}/mindroom/!room:example.com/$event?via=example.com`
    );
  });
});
