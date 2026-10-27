import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { ClientConfigAuthenticationError } from '../components/ClientConfigLoader';
import { ConfigConfigError } from './ConfigConfig';

vi.mock('folds', () => ({
  Box: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
  Button: ({
    children,
    onClick,
  }: {
    children?: React.ReactNode;
    onClick?: (event?: unknown) => void;
  }) => React.createElement('button', { onClick }, children),
  Dialog: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('span', null, children),
  color: {
    Critical: {
      Main: 'red',
    },
  },
  config: {
    space: {
      S400: '16px',
    },
  },
}));

vi.mock('../components/splash-screen', () => ({
  MindRoomSplashScreen: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
  SplashScreen: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

const getButtonByText = (renderer: ReactTestRenderer, text: string) =>
  renderer.root
    .findAllByType('button')
    .find((button) => button.findAllByType('span').some((span) => span.children.includes(text)));

const renderConfigError = ({
  retry,
  ignore,
  authenticate,
  error = new Error('config failed'),
}: {
  retry: () => void;
  ignore?: () => void;
  authenticate: () => void;
  error?: unknown;
}) => {
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(
      <ConfigConfigError error={error} retry={retry} ignore={ignore} authenticate={authenticate} />
    );
  });
  return renderer!;
};

describe('ConfigConfigError', () => {
  it('does not forward the click event into the retry callback', () => {
    const retry = vi.fn();
    const ignore = vi.fn();
    const authenticate = vi.fn();
    const renderer = renderConfigError({ retry, ignore, authenticate });

    const retryButton = getButtonByText(renderer, 'Retry');
    expect(retryButton).toBeDefined();

    act(() => {
      retryButton?.props.onClick({ type: 'click' });
    });

    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledWith();
  });

  it('does not forward the click event into the ignore callback', () => {
    const retry = vi.fn();
    const ignore = vi.fn();
    const authenticate = vi.fn();
    const renderer = renderConfigError({ retry, ignore, authenticate });

    const continueButton = getButtonByText(renderer, 'Continue offline');
    expect(continueButton).toBeDefined();

    act(() => {
      continueButton?.props.onClick({ type: 'click' });
    });

    expect(ignore).toHaveBeenCalledTimes(1);
    expect(ignore).toHaveBeenCalledWith();
  });

  it('does not offer offline mode without a cached configuration', () => {
    const renderer = renderConfigError({
      retry: vi.fn(),
      authenticate: vi.fn(),
      error: new ClientConfigAuthenticationError(),
    });

    expect(getButtonByText(renderer, 'Continue offline')).toBeUndefined();
    expect(
      renderer.root
        .findAllByType('span')
        .some((span) => span.children.includes('Sign in again to reconnect.'))
    ).toBe(true);
  });

  it('uses top-level sign-in recovery for an authentication redirect', () => {
    const retry = vi.fn();
    const ignore = vi.fn();
    const authenticate = vi.fn();
    const renderer = renderConfigError({
      retry,
      ignore,
      authenticate,
      error: new ClientConfigAuthenticationError(),
    });

    expect(
      renderer.root
        .findAllByType('span')
        .some((span) => span.children.includes('Your web session has expired.'))
    ).toBe(true);
    const signInButton = getButtonByText(renderer, 'Sign in again');
    expect(signInButton).toBeDefined();

    act(() => {
      signInButton?.props.onClick({ type: 'click' });
    });

    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(authenticate).toHaveBeenCalledWith();
    expect(retry).not.toHaveBeenCalled();
  });
});
