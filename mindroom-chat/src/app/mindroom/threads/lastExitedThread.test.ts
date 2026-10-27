import { createStore } from 'jotai';
import { describe, expect, it } from 'vitest';
import { lastExitedThreadAtom } from './lastExitedThread';

describe('lastExitedThreadAtom', () => {
  it('defaults to null', () => {
    const store = createStore();

    expect(store.get(lastExitedThreadAtom)).toBeNull();
  });

  it('stores the last exited room/thread target', () => {
    const store = createStore();

    store.set(lastExitedThreadAtom, {
      roomId: '!room:example.org',
      threadId: '$thread',
    });

    expect(store.get(lastExitedThreadAtom)).toEqual({
      roomId: '!room:example.org',
      threadId: '$thread',
    });
  });

  it('clears the target back to null', () => {
    const store = createStore();

    store.set(lastExitedThreadAtom, {
      roomId: '!room:example.org',
      threadId: '$thread',
    });
    store.set(lastExitedThreadAtom, null);

    expect(store.get(lastExitedThreadAtom)).toBeNull();
  });
});
