import React, { useEffect } from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { atom, createStore, Provider, useAtomValue, useSetAtom } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientBindAtoms } from './ClientBindAtoms';
import { useBindAtoms } from '../../state/hooks/useBindAtoms';

const mocks = vi.hoisted(() => ({
  client: { accountValue: 'account-b' },
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => mocks.client,
}));

vi.mock('../../state/hooks/useBindAtoms', () => ({
  useBindAtoms: vi.fn(),
}));

const accountValueAtom = atom('empty');

const useTestAccountBinding = (client: { accountValue: string }) => {
  const setAccountValue = useSetAtom(accountValueAtom);
  useEffect(() => {
    setAccountValue(client.accountValue);
  }, [client, setAccountValue]);
};

describe('ClientBindAtoms', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    renderer?.unmount();
    renderer = undefined;
    vi.mocked(useBindAtoms).mockReset();
  });

  it('does not render account children until binding effects seed the current account', () => {
    const store = createStore();
    store.set(accountValueAtom, 'account-a');
    const observedValues: string[] = [];
    vi.mocked(useBindAtoms).mockImplementation(useTestAccountBinding as never);

    const Observer = () => {
      observedValues.push(useAtomValue(accountValueAtom));
      return null;
    };

    act(() => {
      renderer = create(
        <Provider store={store}>
          <ClientBindAtoms>
            <Observer />
          </ClientBindAtoms>
        </Provider>
      );
    });

    expect(observedValues.length).toBeGreaterThan(0);
    expect(observedValues.every((value) => value === 'account-b')).toBe(true);
  });

  it('closes the gate synchronously when the Matrix client changes', () => {
    const store = createStore();
    const observedValues: string[] = [];
    vi.mocked(useBindAtoms).mockImplementation(useTestAccountBinding as never);

    const Observer = () => {
      observedValues.push(useAtomValue(accountValueAtom));
      return null;
    };
    const renderTree = () => (
      <Provider store={store}>
        <ClientBindAtoms>
          <Observer />
        </ClientBindAtoms>
      </Provider>
    );

    act(() => {
      mocks.client = { accountValue: 'account-a' };
      renderer = create(renderTree());
    });

    act(() => {
      mocks.client = { accountValue: 'account-b' };
      renderer?.update(renderTree());
    });

    expect(observedValues).toContain('account-a');
    expect(observedValues).toContain('account-b');
    expect(observedValues.slice(observedValues.indexOf('account-b'))).not.toContain('account-a');
  });
});
