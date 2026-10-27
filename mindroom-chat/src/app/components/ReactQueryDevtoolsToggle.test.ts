// @vitest-environment jsdom

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isReactQueryDevtoolsEnabled,
  ReactQueryDevtoolsToggle,
  REACT_QUERY_DEVTOOLS_STORAGE_KEY,
} from './ReactQueryDevtoolsToggle';

vi.mock('@tanstack/react-query-devtools', async () => {
  const ReactModule = await import('react');

  return {
    ReactQueryDevtools: ({ initialIsOpen }: { initialIsOpen: boolean }) =>
      ReactModule.createElement(
        'div',
        {
          'data-initial-open': String(initialIsOpen),
          'data-testid': 'react-query-devtools',
        },
        'React Query Devtools'
      ),
  };
});

const createLocation = (search = '', hash = '') => ({ search, hash });

const createStorage = () => {
  const values = new Map<string, string>();

  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
};

const flushPromises = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

describe('isReactQueryDevtoolsEnabled', () => {
  it('defaults to disabled', () => {
    expect(
      isReactQueryDevtoolsEnabled({
        envValue: undefined,
        location: createLocation(),
        storage: createStorage(),
      })
    ).toBe(false);
  });

  it('enables from the Vite env flag', () => {
    expect(
      isReactQueryDevtoolsEnabled({
        envValue: 'true',
        location: createLocation(),
        storage: createStorage(),
      })
    ).toBe(true);
  });

  it('enables from the persisted localStorage flag', () => {
    const storage = createStorage();
    storage.setItem(REACT_QUERY_DEVTOOLS_STORAGE_KEY, 'true');

    expect(
      isReactQueryDevtoolsEnabled({
        envValue: undefined,
        location: createLocation(),
        storage,
      })
    ).toBe(true);
  });

  it('enables from the query param and persists the flag', () => {
    const storage = createStorage();

    expect(
      isReactQueryDevtoolsEnabled({
        envValue: undefined,
        location: createLocation('?reactQueryDevtools=1'),
        storage,
      })
    ).toBe(true);

    expect(storage.getItem(REACT_QUERY_DEVTOOLS_STORAGE_KEY)).toBe('true');
  });

  it('disables from the query param and clears the persisted flag', () => {
    const storage = createStorage();
    storage.setItem(REACT_QUERY_DEVTOOLS_STORAGE_KEY, 'true');

    expect(
      isReactQueryDevtoolsEnabled({
        envValue: 'true',
        location: createLocation('?reactQueryDevtools=false'),
        storage,
      })
    ).toBe(false);

    expect(storage.getItem(REACT_QUERY_DEVTOOLS_STORAGE_KEY)).toBeNull();
  });

  it('checks hash-router query params', () => {
    const storage = createStorage();

    expect(
      isReactQueryDevtoolsEnabled({
        envValue: undefined,
        location: createLocation('', '#/room/!room:server?reactQueryDevtools=true'),
        storage,
      })
    ).toBe(true);

    expect(storage.getItem(REACT_QUERY_DEVTOOLS_STORAGE_KEY)).toBe('true');
  });

  it('gives explicit query-param opt-out precedence over opt-in', () => {
    const storage = createStorage();
    storage.setItem(REACT_QUERY_DEVTOOLS_STORAGE_KEY, 'true');

    expect(
      isReactQueryDevtoolsEnabled({
        envValue: 'true',
        location: createLocation('?reactQueryDevtools=1&reactQueryDevtools=0'),
        storage,
      })
    ).toBe(false);

    expect(storage.getItem(REACT_QUERY_DEVTOOLS_STORAGE_KEY)).toBeNull();
  });
});

describe('ReactQueryDevtoolsToggle', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('renders nothing by default', () => {
    const renderer = create(React.createElement(ReactQueryDevtoolsToggle));

    expect(renderer.toJSON()).toBeNull();
  });

  it('lazy-renders the upstream devtools when explicitly enabled', async () => {
    window.localStorage.setItem(REACT_QUERY_DEVTOOLS_STORAGE_KEY, 'true');

    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(React.createElement(ReactQueryDevtoolsToggle));
      await flushPromises();
    });

    expect(renderer?.root.findByProps({ 'data-testid': 'react-query-devtools' }).props).toMatchObject(
      {
        'data-initial-open': 'false',
      }
    );
  });
});
