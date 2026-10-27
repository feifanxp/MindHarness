import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { voiceMessagePlaybackRateAtom } from '../../mindroom/settings/voiceMessageSettings';
import { VoicePlaybackRateButton } from './VoicePlaybackRateButton';

type StorageListener = (event: StorageEvent) => void;

vi.mock('folds', () => ({
  Text: ({ as = 'span', children, ...props }: { as?: string; children?: React.ReactNode }) =>
    React.createElement(as, props, children),
}));

vi.mock('./VoicePlaybackRateButton.css', () => ({
  Button: 'Button',
  Label: 'Label',
}));

const renderButton = (store = createStore()): ReactTestRenderer => {
  let renderer: ReactTestRenderer | undefined;

  act(() => {
    renderer = create(
      React.createElement(Provider, { store }, React.createElement(VoicePlaybackRateButton))
    );
  });

  if (!renderer) throw new Error('VoicePlaybackRateButton failed to render');
  return renderer;
};

describe('VoicePlaybackRateButton', () => {
  const storageListeners = new Set<StorageListener>();

  beforeEach(() => {
    storageListeners.clear();
    vi.stubGlobal('window', {
      addEventListener: vi.fn((type: string, listener: StorageListener) => {
        if (type === 'storage') storageListeners.add(listener);
      }),
      removeEventListener: vi.fn((type: string, listener: StorageListener) => {
        if (type === 'storage') storageListeners.delete(listener);
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    storageListeners.clear();
  });

  it('renders the current formatted label with the multiplication sign', () => {
    const store = createStore();
    const renderer = renderButton(store);

    act(() => {
      store.set(voiceMessagePlaybackRateAtom, 1.5);
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('1.5×');

    act(() => {
      renderer.unmount();
    });
  });

  it('click cycles to the next persisted value', () => {
    const store = createStore();
    const renderer = renderButton(store);

    act(() => {
      renderer.root.findByType('button').props.onClick();
    });

    expect(store.get(voiceMessagePlaybackRateAtom)).toBe(1.5);
    expect(JSON.stringify(renderer.toJSON())).toContain('1.5×');

    act(() => {
      renderer.unmount();
    });
  });

  it('uses the exact aria-label format', () => {
    const store = createStore();
    const renderer = renderButton(store);

    act(() => {
      store.set(voiceMessagePlaybackRateAtom, 1.5);
    });

    expect(renderer.root.findByType('button').props['aria-label']).toBe(
      'Playback speed, currently 1.5×, click to cycle'
    );

    act(() => {
      renderer.unmount();
    });
  });
});
