import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { validateAuthMetadata } from 'matrix-js-sdk/lib/oidc/validate';
import { ServerConfigsLoader, type ServerConfigs } from './ServerConfigsLoader';

vi.mock('matrix-js-sdk/lib/oidc/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('matrix-js-sdk/lib/oidc/validate')>();

  return {
    ...actual,
    validateAuthMetadata: vi.fn(),
  };
});

const flushPromises = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

describe('ServerConfigsLoader', () => {
  it('loads configs from an explicit Matrix client without requiring context', async () => {
    const getCapabilities = vi.fn().mockResolvedValue({ 'm.change_password': { enabled: true } });
    const getMediaConfig = vi.fn().mockResolvedValue({ 'm.upload.size': 1024 });
    const getAuthMetadata = vi.fn().mockRejectedValue(new Error('auth metadata unavailable'));
    let latestConfigs: ServerConfigs | undefined;

    const renderer = create(
      React.createElement(
        ServerConfigsLoader as never,
        {
          mx: {
            getCapabilities,
            getMediaConfig,
            getAuthMetadata,
          } as never,
        } as never,
        ((configs: ServerConfigs) => {
          latestConfigs = configs;
          return React.createElement('div', null, 'Loaded');
        }) as never
      )
    );

    await act(async () => {
      await flushPromises();
      await flushPromises();
    });

    expect(getCapabilities).toHaveBeenCalledTimes(1);
    expect(getMediaConfig).toHaveBeenCalledTimes(1);
    expect(getAuthMetadata).toHaveBeenCalledTimes(1);
    expect(latestConfigs).toEqual({
      capabilities: { 'm.change_password': { enabled: true } },
      mediaConfig: { 'm.upload.size': 1024 },
      authMetadata: undefined,
    });

    renderer.unmount();
  });

  it('does not validate or log auth metadata when fetching it fails', async () => {
    const getCapabilities = vi.fn().mockResolvedValue({ 'm.change_password': { enabled: true } });
    const getMediaConfig = vi.fn().mockResolvedValue({ 'm.upload.size': 1024 });
    const getAuthMetadata = vi.fn().mockRejectedValue(new Error('auth metadata unavailable'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let latestConfigs: ServerConfigs | undefined;

    const renderer = create(
      React.createElement(
        ServerConfigsLoader as never,
        {
          mx: {
            getCapabilities,
            getMediaConfig,
            getAuthMetadata,
          } as never,
        } as never,
        ((configs: ServerConfigs) => {
          latestConfigs = configs;
          return React.createElement('div', null, 'Loaded');
        }) as never
      )
    );

    await act(async () => {
      await flushPromises();
      await flushPromises();
    });

    expect(getCapabilities).toHaveBeenCalledTimes(1);
    expect(getMediaConfig).toHaveBeenCalledTimes(1);
    expect(getAuthMetadata).toHaveBeenCalledTimes(1);
    expect(vi.mocked(validateAuthMetadata)).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(latestConfigs).toEqual({
      capabilities: { 'm.change_password': { enabled: true } },
      mediaConfig: { 'm.upload.size': 1024 },
      authMetadata: undefined,
    });

    renderer.unmount();
  });
});
