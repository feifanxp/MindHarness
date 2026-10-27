// @vitest-environment jsdom

import React from 'react';
import { Provider, createStore } from 'jotai';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AsyncStatus } from '../../../hooks/useAsyncCallback';
import { VoiceAudioContent } from './VoiceAudioContent';

const mocks = vi.hoisted(() => ({
  srcState: { status: 'success' as const, data: 'blob:voice-a' } as {
    status: string;
    data?: string;
  },
  loadSrc: vi.fn(() => Promise.resolve('blob:voice-a')),
}));

vi.mock('folds', () => ({
  Icon: ({ filled: _filled, ...props }: Record<string, unknown>) =>
    React.createElement('span', props),
  IconButton: React.forwardRef<
    HTMLButtonElement,
    { children?: React.ReactNode; onClick?: () => void }
  >(({ children, onClick, ...props }, ref) =>
    React.createElement('button', { ...props, onClick, ref }, children)
  ),
  Icons: {
    Pause: 'pause',
    Play: 'play',
    VerticalDots: 'vertical-dots',
  },
  Menu: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('div', props, children),
  PopOut: ({ anchor, content }: { anchor?: unknown; content: React.ReactNode }) =>
    anchor ? React.createElement('div', { 'data-popout': 'true' }, content) : null,
  Spinner: (props: Record<string, unknown>) => React.createElement('span', props),
  Text: ({
    children,
    truncate: _truncate,
    ...props
  }: {
    children?: React.ReactNode;
    truncate?: boolean;
  }) => React.createElement('span', props, children),
}));

vi.mock('./VoiceAudioContent.css', () => ({
  Audio: 'Audio',
  Title: 'Title',
  Controls: 'Controls',
  Error: 'Error',
  Capsule: 'Capsule',
  MoreCell: 'MoreCell',
  MoreMenu: 'MoreMenu',
  MoreMenuAction: 'MoreMenuAction',
  MoreMenuMeta: 'MoreMenuMeta',
  MoreMenuMetaLabel: 'MoreMenuMetaLabel',
  MoreMenuMetaValue: 'MoreMenuMetaValue',
  PlayCell: 'PlayCell',
  PlayButton: 'PlayButton',
  PlayIcon: 'PlayIcon',
  RateCell: 'RateCell',
  Root: 'Root',
  Time: 'Time',
  WaveformCell: 'WaveformCell',
}));

vi.mock('../../voice/VoicePlaybackRateButton', () => ({
  VoicePlaybackRateButton: () => React.createElement('button', { 'aria-label': 'Playback speed' }),
}));

vi.mock('../../voice/VoiceVolumeButton', () => ({
  VoiceVolumeButton: () => React.createElement('button', { 'aria-label': 'Voice volume' }),
}));

vi.mock('../../voice/VoiceWaveform', () => ({
  VoiceWaveform: () => React.createElement('button', { 'aria-label': 'Seek voice message' }),
}));

vi.mock('./useAudioContentSource', () => ({
  getAudioContentSourceIdentity: ({
    mimeType,
    url,
    encInfo,
  }: {
    mimeType: string;
    url: string;
    encInfo?: { v?: string; iv?: string; hashes?: { sha256?: string }; key?: { k?: string } };
  }) =>
    JSON.stringify([
      mimeType,
      url,
      encInfo?.v ?? '',
      encInfo?.iv ?? '',
      encInfo?.hashes?.sha256 ?? '',
      encInfo?.key?.k ?? '',
    ]),
  useAudioContentSource: () => [mocks.srcState, mocks.loadSrc],
}));

vi.mock('../../../hooks/useThrottle', () => ({
  useThrottle: (callback: unknown) => callback,
}));

vi.mock('../FileHeader', () => ({
  FileDownloadButton: () => React.createElement('button', { 'aria-label': 'Download audio' }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const renderVoiceAudioContent = (url: string) =>
  React.createElement(
    Provider,
    { store: createStore() },
    React.createElement(VoiceAudioContent, {
      mimeType: 'audio/ogg',
      url,
      info: {
        mimetype: 'audio/ogg',
        duration: 10000,
      },
      waveform: [0, 512, 1024],
    })
  );

describe('VoiceAudioContent media element', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.srcState = { status: AsyncStatus.Success, data: 'blob:voice-a' };
    mocks.loadSrc.mockReset();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it.each(['audio', 'source'])(
    'shows %s playback failures and prevents repeated failed playback',
    (target) => {
      act(() => {
        root.render(renderVoiceAudioContent('mxc://mindroom/voice-a'));
      });
      act(() => {
        container.querySelector(target)!.dispatchEvent(new Event('error'));
      });
      expect(container.querySelector('[role="status"]')?.textContent).toContain(
        'This audio cannot be played here'
      );
      expect(
        container.querySelector<HTMLButtonElement>('[aria-label="Play voice message"]')?.disabled
      ).toBe(true);
      expect(
        container.querySelector<HTMLButtonElement>('[aria-label="More audio options"]')?.disabled
      ).toBe(false);
    }
  );

  it('remounts the audio element when the loaded media source changes', () => {
    act(() => {
      root.render(renderVoiceAudioContent('mxc://mindroom/voice-a'));
    });

    const audioA = container.querySelector('audio');
    expect(audioA).not.toBeNull();
    expect(audioA?.querySelector('source')?.getAttribute('src')).toBe('blob:voice-a');

    mocks.srcState = { status: AsyncStatus.Success, data: 'blob:voice-b' };
    act(() => {
      root.render(renderVoiceAudioContent('mxc://mindroom/voice-b'));
    });

    const audioB = container.querySelector('audio');
    expect(audioB).not.toBeNull();
    expect(audioB).not.toBe(audioA);
    expect(audioB?.querySelector('source')?.getAttribute('src')).toBe('blob:voice-b');
  });

  it('binds real media hooks to the remounted loaded audio element', async () => {
    mocks.srcState = { status: AsyncStatus.Idle };
    await act(async () => {
      root.render(renderVoiceAudioContent('mxc://mindroom/voice-a'));
      await Promise.resolve();
    });

    const audioA = container.querySelector('audio') as HTMLAudioElement;
    expect(audioA).not.toBeNull();
    expect(audioA.querySelector('source')).toBeNull();

    mocks.srcState = { status: AsyncStatus.Success, data: 'blob:voice-b' };
    await act(async () => {
      root.render(renderVoiceAudioContent('mxc://mindroom/voice-b'));
      await Promise.resolve();
    });

    const audioB = container.querySelector('audio') as HTMLAudioElement;
    expect(audioB).not.toBe(audioA);
    expect(audioB.querySelector('source')?.getAttribute('src')).toBe('blob:voice-b');

    Object.defineProperty(audioA, 'duration', { configurable: true, value: 99 });
    Object.defineProperty(audioA, 'currentTime', { configurable: true, value: 98 });
    Object.defineProperty(audioA, 'paused', { configurable: true, value: false });
    await act(async () => {
      audioA.dispatchEvent(new Event('timeupdate'));
      audioA.dispatchEvent(new Event('play'));
      await Promise.resolve();
    });

    expect(container.querySelector('[title="0:00 / 0:10"]')?.textContent).toBe('0:10');
    expect(container.querySelector('[aria-label="Play voice message"]')).not.toBeNull();

    Object.defineProperty(audioB, 'duration', { configurable: true, value: 12 });
    Object.defineProperty(audioB, 'currentTime', { configurable: true, value: 4 });
    Object.defineProperty(audioB, 'paused', { configurable: true, value: false });
    await act(async () => {
      audioB.dispatchEvent(new Event('timeupdate'));
      audioB.dispatchEvent(new Event('play'));
      await Promise.resolve();
    });

    expect(container.querySelector('[title="0:04 / 0:12"]')?.textContent).toBe('0:04');
    expect(container.querySelector('[aria-label="Pause voice message"]')).not.toBeNull();

    Object.defineProperty(audioB, 'paused', { configurable: true, value: true });
    await act(async () => {
      audioB.dispatchEvent(new Event('pause'));
      await Promise.resolve();
    });

    expect(container.querySelector('[aria-label="Play voice message"]')).not.toBeNull();
  });
});
