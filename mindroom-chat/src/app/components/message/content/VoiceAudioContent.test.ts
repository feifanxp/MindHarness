import React from 'react';
import { Provider, createStore, type Store } from 'jotai';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AsyncStatus } from '../../../hooks/useAsyncCallback';
import {
  voiceMessagePlaybackRateAtom,
  voiceMessageVolumeAtom,
} from '../../../mindroom/settings/voiceMessageSettings';
import { VoiceAudioContent } from './VoiceAudioContent';

const mocks = vi.hoisted(() => ({
  srcState: { status: 'idle' as const } as { status: string; data?: string },
  loadSrc: vi.fn(() => Promise.resolve('blob:voice')),
  playing: false,
  setPlaying: vi.fn(),
  playTimeCallback: undefined as ((duration: number, currentTime: number) => void) | undefined,
}));

vi.mock('folds', () => ({
  Icon: (props: Record<string, unknown>) => React.createElement('span', props),
  IconButton: React.forwardRef<
    HTMLButtonElement,
    { children?: React.ReactNode; onClick?: () => void }
  >(({ children, onClick, ...props }, ref) =>
    React.createElement('button', { ...props, onClick, ref }, children)
  ),
  Icons: {
    Download: 'download',
    Pause: 'pause',
    Play: 'play',
    VerticalDots: 'vertical-dots',
    VolumeHigh: 'volume-high',
    VolumeMute: 'volume-mute',
  },
  Menu: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('div', props, children),
  PopOut: ({ anchor, content }: { anchor?: unknown; content: React.ReactNode }) =>
    anchor ? React.createElement('div', { 'data-popout': 'true' }, content) : null,
  Spinner: (props: Record<string, unknown>) => React.createElement('span', props),
  Text: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('span', props, children),
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

vi.mock('../../voice/VoiceVolumeButton.css', () => ({
  Button: 'Button',
  Menu: 'Menu',
  Thumb: 'Thumb',
  Track: 'Track',
  TrackLine: 'TrackLine',
}));

vi.mock('../../voice/VoicePlaybackRateButton.css', () => ({
  Button: 'Button',
  Label: 'Label',
}));

vi.mock('../../voice/VoiceWaveform.css', () => ({
  Bar: 'Bar',
  BarActive: 'BarActive',
  BarCompactUnrecorded: 'BarCompactUnrecorded',
  Svg: 'Svg',
  Waveform: 'Waveform',
  WaveformDimmed: 'WaveformDimmed',
  WaveformSeek: 'WaveformSeek',
  SeekInput: 'SeekInput',
}));

vi.mock('focus-trap-react', () => ({
  default: ({
    children,
    focusTrapOptions,
  }: {
    children?: React.ReactNode;
    focusTrapOptions?: Record<string, unknown>;
  }) => React.createElement('div', { 'data-focus-trap': true, focusTrapOptions }, children),
}));

vi.mock('react-range', () => ({
  Range: ({
    values,
    onChange,
    renderTrack,
    renderThumb,
  }: {
    values: number[];
    onChange: (values: number[]) => void;
    renderTrack: (params: {
      props: Record<string, unknown>;
      children: React.ReactNode;
    }) => React.ReactNode;
    renderThumb: (params: { props: Record<string, unknown> }) => React.ReactNode;
  }) =>
    React.createElement(
      'div',
      { 'data-range': 'true' },
      renderTrack({
        props: {},
        children: renderThumb({
          props: {
            style: {
              position: 'absolute',
              transform: 'translate(118px, 8px)',
            },
          },
        }),
      }),
      React.createElement('input', {
        'aria-label': 'Voice volume slider',
        type: 'range',
        value: values[0],
        onChange: (event: { currentTarget: { value: string } }) =>
          onChange([Number(event.currentTarget.value)]),
      })
    ),
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

vi.mock('../FileHeader', () => ({
  FileDownloadButton: ({ filename, mimeType }: { filename: string; mimeType: string }) =>
    React.createElement('button', {
      'aria-label': `Download ${filename}`,
      'data-download-filename': filename,
      'data-download-mime': mimeType,
    }),
}));

vi.mock('../../../hooks/media', () => ({
  useMediaLoading: () => ({ loading: false }),
  useMediaPlay: () => ({ playing: mocks.playing, setPlaying: mocks.setPlaying }),
  useMediaPlayTimeCallback: (
    _getAudio: unknown,
    callback: (duration: number, currentTime: number) => void
  ) => {
    mocks.playTimeCallback = callback;
  },
}));

vi.mock('../../../hooks/useThrottle', () => ({
  useThrottle: (callback: unknown) => callback,
}));

type StorageListener = (event: StorageEvent) => void;

type AudioMock = HTMLAudioElement & {
  mozPreservesPitch?: boolean;
  webkitPreservesPitch?: boolean;
};

const createAudioMock = (): AudioMock =>
  ({
    currentTime: 0,
    duration: 10,
    readyState: 1,
    muted: false,
    playbackRate: 1,
    preservesPitch: false,
    volume: 1,
    mozPreservesPitch: false,
    webkitPreservesPitch: false,
  } as AudioMock);

const renderVoiceAudioContent = (props?: Partial<React.ComponentProps<typeof VoiceAudioContent>>) =>
  React.createElement(VoiceAudioContent, {
    mimeType: 'audio/ogg',
    url: props?.url ?? 'mxc://mindroom/voice',
    info: {
      mimetype: 'audio/ogg',
      duration: 10000,
      size: 12000,
      ...props?.info,
    },
    filename: (props as { filename?: string } | undefined)?.filename ?? 'voice.ogg',
    waveform: props?.waveform ?? [0, 512, 1024],
    encInfo: props?.encInfo,
    label: props?.label,
    isVoiceMessage: props?.isVoiceMessage,
  });

const renderVoiceAudio = (
  store: Store = createStore(),
  props?: Partial<React.ComponentProps<typeof VoiceAudioContent>>
) => React.createElement(Provider, { store }, renderVoiceAudioContent(props));

const openAudioOptions = (renderer: ReactTestRenderer, index = 0) => {
  act(() => {
    renderer.root
      .findAllByType('button')
      .filter((button) => button.props['aria-label'] === 'More audio options')
      [index].props.onClick({
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, top: 0, width: 24, height: 24 }),
        },
      });
  });
};

describe('VoiceAudioContent', () => {
  let renderer: ReactTestRenderer;
  const storageListeners = new Set<StorageListener>();

  beforeEach(() => {
    mocks.srcState = { status: AsyncStatus.Idle };
    mocks.loadSrc.mockReset();
    mocks.loadSrc.mockResolvedValue('blob:voice');
    mocks.playing = false;
    mocks.setPlaying.mockReset();
    mocks.playTimeCallback = undefined;
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

  it('renders play, waveform seek, timer, and speed before interaction', () => {
    renderer = create(renderVoiceAudio());

    expect(renderer.root.findByProps({ className: 'Root' })).toBeTruthy();
    expect(renderer.root.findByProps({ className: 'WaveformCell' })).toBeTruthy();
    const buttons = renderer.root.findAllByType('button');
    expect(buttons.map((button) => button.props['aria-label'])).toEqual([
      'Play voice message',
      'Playback speed, currently 1×, click to cycle',
      'More audio options',
    ]);
    expect(renderer.root.findAllByType('rect')).toHaveLength(48);
    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain('0:00 / 0:10');
    expect(rendered).not.toMatch(/download|mute/i);

    act(() => {
      renderer.unmount();
    });
  });

  it('keeps volume, download, and attachment metadata in the More menu', () => {
    renderer = create(renderVoiceAudio(createStore(), { filename: 'clip.ogg' }));

    act(() => {
      renderer.root.findByProps({ 'aria-label': 'More audio options' }).props.onClick({
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, top: 0, width: 44, height: 44 }),
        },
      });
    });

    expect(
      renderer.root.findByProps({ 'aria-label': 'Voice volume, currently 100%' })
    ).toBeTruthy();
    expect(renderer.root.findByProps({ 'data-download-filename': 'clip.ogg' })).toBeTruthy();
    expect(JSON.stringify(renderer.toJSON())).toContain('clip.ogg');
    expect(JSON.stringify(renderer.toJSON())).toContain('audio/ogg');
    expect(JSON.stringify(renderer.toJSON())).toContain('12.0 KB');
    expect(JSON.stringify(renderer.toJSON())).toContain('0:10');

    act(() => {
      renderer.unmount();
    });
  });

  it('opens More after play without reading a cleared event target from the state updater', () => {
    renderer = create(renderVoiceAudio(createStore(), { filename: 'clip.ogg' }));

    const moreTriggerTarget = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 44, height: 44 }),
    };
    let currentTarget: typeof moreTriggerTarget | null = moreTriggerTarget;
    const moreClickEvent = {
      get currentTarget() {
        return currentTarget;
      },
    };

    expect(() => {
      act(() => {
        renderer.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
        renderer.root
          .findByProps({ 'aria-label': 'More audio options' })
          .props.onClick(moreClickEvent);
        currentTarget = null;
      });
    }).not.toThrow();

    expect(renderer.root.findByProps({ 'data-download-filename': 'clip.ogg' })).toBeTruthy();

    act(() => {
      renderer.unmount();
    });
  });

  it('reopens volume during deactivation without reading a cleared event target', () => {
    renderer = create(renderVoiceAudio());

    openAudioOptions(renderer);

    const volumeTriggerTarget = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 44, height: 44 }),
    };

    act(() => {
      renderer.root
        .findByProps({ 'aria-label': 'Voice volume, currently 100%' })
        .props.onClick({ currentTarget: volumeTriggerTarget });
    });

    const focusTrapOptions = renderer.root.findAllByProps({ 'data-focus-trap': true })[1].props
      .focusTrapOptions as {
      onDeactivate: () => void;
    };
    let currentTarget: typeof volumeTriggerTarget | null = volumeTriggerTarget;
    const volumeClickEvent = {
      get currentTarget() {
        return currentTarget;
      },
    };

    expect(() => {
      act(() => {
        focusTrapOptions.onDeactivate();
        renderer.root
          .findByProps({ 'aria-label': 'Voice volume, currently 100%' })
          .props.onClick(volumeClickEvent);
        currentTarget = null;
      });
    }).not.toThrow();

    expect(renderer.root.findAllByProps({ 'data-popout': 'true' })).toHaveLength(2);

    act(() => {
      renderer.unmount();
    });
  });

  it('lets listeners set playback speed before loading audio', () => {
    const store = createStore();
    renderer = create(renderVoiceAudio(store));
    act(() => {
      renderer.root
        .findByProps({
          'aria-label': 'Playback speed, currently 1×, click to cycle',
        })
        .props.onClick();
    });
    expect(store.get(voiceMessagePlaybackRateAtom)).toBe(1.5);
    expect(mocks.loadSrc).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('shows an audio filename without opening the options menu', () => {
    renderer = create(
      renderVoiceAudio(createStore(), {
        filename: 'Interview.mp3',
        label: 'audio',
        isVoiceMessage: false,
      })
    );
    expect(JSON.stringify(renderer.toJSON())).toContain('Interview.mp3');
    renderer.unmount();
  });

  it('explains source loading failures and allows another play attempt', () => {
    mocks.srcState = { status: AsyncStatus.Error };
    renderer = create(renderVoiceAudio());
    expect(
      renderer.root
        .findAllByType('span')
        .find((node) => node.props.role === 'status')
        ?.children.join('')
    ).toContain('Unable to load audio');
    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
    });
    expect(mocks.loadSrc).toHaveBeenCalledOnce();
    renderer.unmount();
  });

  it('lazily loads media on first play and autoplays once loaded', () => {
    renderer = create(renderVoiceAudio());

    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
    });

    expect(mocks.loadSrc).toHaveBeenCalledOnce();
    expect(renderer.root.findByType('audio').props.autoPlay).toBe(true);
    expect(
      renderer.root.findByProps({ 'aria-label': 'Playback speed, currently 1×, click to cycle' })
    ).toBeTruthy();

    act(() => {
      renderer.unmount();
    });
  });

  it('uses the media play controller after source load', () => {
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice',
    };
    renderer = create(renderVoiceAudio());

    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
    });

    expect(mocks.setPlaying).toHaveBeenCalledWith(true);
    expect(renderer.root.findByType('audio').props.autoPlay).toBe(false);
    expect(
      renderer.root.findByProps({ 'aria-label': 'Playback speed, currently 1×, click to cycle' })
    ).toBeTruthy();

    act(() => {
      renderer.unmount();
    });
  });

  it('seeks through waveform click progress', () => {
    const audio = createAudioMock();
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice',
    };
    renderer = create(renderVoiceAudio(), {
      createNodeMock: (element) => (element.type === 'audio' ? audio : null),
    });

    act(() => {
      renderer.root
        .findByProps({ 'aria-label': 'Seek voice message' })
        .props.onChange({ currentTarget: { value: '25' } });
    });

    expect(audio.currentTime).toBe(2.5);
    expect(
      renderer.root.findByProps({ 'aria-label': 'Playback speed, currently 1×, click to cycle' })
    ).toBeTruthy();

    act(() => {
      renderer.unmount();
    });
  });

  it('keeps the playback speed pill visible after pause once revealed', () => {
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice',
    };
    renderer = create(renderVoiceAudio());

    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
    });
    mocks.playing = true;
    act(() => {
      renderer.update(renderVoiceAudio());
    });
    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Pause voice message' }).props.onClick();
    });

    expect(
      renderer.root.findByProps({ 'aria-label': 'Playback speed, currently 1×, click to cycle' })
    ).toBeTruthy();

    act(() => {
      renderer.unmount();
    });
  });

  it('keeps the latest pending seek until metadata is ready before first playback', async () => {
    const audio = createAudioMock();
    Object.defineProperty(audio, 'readyState', { configurable: true, value: 0 });
    renderer = create(renderVoiceAudio(), {
      createNodeMock: (element) => (element.type === 'audio' ? audio : null),
    });

    await act(async () => {
      renderer.root
        .findByProps({ 'aria-label': 'Seek voice message' })
        .props.onChange({ currentTarget: { value: '50' } });
    });

    expect(mocks.loadSrc).toHaveBeenCalledOnce();
    expect(JSON.stringify(renderer.toJSON())).toContain('0:05 / 0:10');

    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice',
    };
    await act(async () => {
      renderer.update(renderVoiceAudio());
    });

    expect(audio.currentTime).toBe(0);

    act(() => {
      renderer.root
        .findByProps({ 'aria-label': 'Seek voice message' })
        .props.onChange({ currentTarget: { value: '75' } });
    });
    expect(audio.currentTime).toBe(0);

    Object.defineProperty(audio, 'readyState', { configurable: true, value: 1 });
    act(() => {
      renderer.root.findByType('audio').props.onLoadedMetadata();
    });
    expect(audio.currentTime).toBe(7.5);

    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
    });

    expect(mocks.setPlaying).toHaveBeenCalledWith(true);

    act(() => {
      renderer.unmount();
    });
  });

  it('clears current time and pending seek when the media identity changes', async () => {
    const store = createStore();
    const audio = createAudioMock();
    renderer = create(renderVoiceAudio(store, { url: 'mxc://mindroom/voice-a' }), {
      createNodeMock: (element) => (element.type === 'audio' ? audio : null),
    });

    await act(async () => {
      renderer.root
        .findByProps({ 'aria-label': 'Seek voice message' })
        .props.onChange({ currentTarget: { value: '50' } });
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('0:05 / 0:10');

    await act(async () => {
      renderer.update(
        renderVoiceAudio(store, {
          url: 'mxc://mindroom/voice-b',
          info: { mimetype: 'audio/ogg', duration: 4000 },
        })
      );
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('0:00 / 0:04');
    expect(renderer.root.findByProps({ title: '0:00 / 0:04' }).props.children).toBe('0:04');

    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice-b',
    };
    await act(async () => {
      renderer.update(
        renderVoiceAudio(store, {
          url: 'mxc://mindroom/voice-b',
          info: { mimetype: 'audio/ogg', duration: 4000 },
        })
      );
    });

    act(() => {
      renderer.root.findByType('audio').props.onLoadedMetadata();
    });
    expect(audio.currentTime).toBe(0);

    act(() => {
      renderer.unmount();
    });
  });

  it('applies playback rate and pitch preservation on rate change', () => {
    const store = createStore();
    const audio = createAudioMock();
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice',
    };

    act(() => {
      renderer = create(renderVoiceAudio(store), {
        createNodeMock: (element) => (element.type === 'audio' ? audio : null),
      });
    });

    act(() => {
      store.set(voiceMessagePlaybackRateAtom, 2);
    });

    expect(audio.playbackRate).toBe(2);
    expect(audio.preservesPitch).toBe(true);
    expect(audio.webkitPreservesPitch).toBe(true);
    expect(audio.mozPreservesPitch).toBe(true);

    act(() => {
      renderer.unmount();
    });
  });

  it('applies volume changes to the audio element and unmutes non-zero volume', () => {
    const store = createStore();
    const audio = createAudioMock();
    audio.muted = true;
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice',
    };

    act(() => {
      renderer = create(renderVoiceAudio(store), {
        createNodeMock: (element) => (element.type === 'audio' ? audio : null),
      });
    });

    act(() => {
      store.set(voiceMessageVolumeAtom, 0.4);
    });

    expect(audio.volume).toBe(0.4);
    expect(audio.muted).toBe(false);

    act(() => {
      renderer.unmount();
    });
  });

  it('mutes the audio element when volume is set to zero', () => {
    const store = createStore();
    const audio = createAudioMock();
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice',
    };

    act(() => {
      renderer = create(renderVoiceAudio(store), {
        createNodeMock: (element) => (element.type === 'audio' ? audio : null),
      });
    });

    act(() => {
      store.set(voiceMessageVolumeAtom, 0);
    });

    expect(audio.volume).toBe(0);
    expect(audio.muted).toBe(true);

    act(() => {
      renderer.unmount();
    });
  });

  it('updates all mounted voice players and audio elements when one volume slider changes', () => {
    const store = createStore();
    const audioA = createAudioMock();
    const audioB = createAudioMock();
    const audioMocks = [audioA, audioB];
    let audioIndex = 0;
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice',
    };

    act(() => {
      renderer = create(
        React.createElement(
          Provider,
          { store },
          React.createElement(React.Fragment, null, [
            React.cloneElement(renderVoiceAudioContent({ url: 'mxc://mindroom/voice-a' }), {
              key: 'voice-a',
            }),
            React.cloneElement(renderVoiceAudioContent({ url: 'mxc://mindroom/voice-b' }), {
              key: 'voice-b',
            }),
          ])
        ),
        {
          createNodeMock: (element) => {
            if (element.type !== 'audio') return null;
            const audio = audioMocks[audioIndex];
            audioIndex += 1;
            return audio;
          },
        }
      );
    });

    openAudioOptions(renderer);
    openAudioOptions(renderer, 1);

    act(() => {
      renderer.root
        .findAllByProps({ 'aria-label': 'Voice volume, currently 100%' })[0]
        .props.onClick({
          currentTarget: {
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 44, height: 44 }),
          },
        });
    });
    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Voice volume slider' }).props.onChange({
        currentTarget: { value: '0.25' },
      });
    });

    expect(store.get(voiceMessageVolumeAtom)).toBe(0.25);
    expect(audioA.volume).toBe(0.25);
    expect(audioB.volume).toBe(0.25);
    expect(
      renderer.root.findAllByProps({ 'aria-label': 'Voice volume, currently 25%' })
    ).toHaveLength(2);

    act(() => {
      renderer.unmount();
    });
  });

  it('closes the volume popover when the trigger is clicked again', () => {
    class TestNode {
      contains(target: unknown) {
        return target === this;
      }

      getBoundingClientRect() {
        return { left: 0, top: 0, width: 44, height: 44 } as DOMRect;
      }
    }
    vi.stubGlobal('Node', TestNode);
    const volumeTriggerNode = new TestNode() as unknown as HTMLButtonElement;

    renderer = create(renderVoiceAudio(), {
      createNodeMock: (element) => {
        if (
          element.type === 'button' &&
          typeof element.props['aria-label'] === 'string' &&
          element.props['aria-label'].startsWith('Voice volume')
        ) {
          return volumeTriggerNode;
        }
        return null;
      },
    });

    openAudioOptions(renderer);

    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Voice volume, currently 100%' }).props.onClick({
        currentTarget: volumeTriggerNode,
      });
    });

    expect(renderer.root.findAllByProps({ 'data-popout': 'true' })).toHaveLength(2);
    const focusTrapOptions = renderer.root.findAllByProps({ 'data-focus-trap': true })[1].props
      .focusTrapOptions as {
      clickOutsideDeactivates: (event: Pick<MouseEvent, 'target'>) => boolean;
      allowOutsideClick: (event: Pick<MouseEvent, 'target'>) => boolean;
    };
    expect(focusTrapOptions.clickOutsideDeactivates({ target: volumeTriggerNode })).toBe(false);
    expect(focusTrapOptions.allowOutsideClick({ target: volumeTriggerNode })).toBe(true);

    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Voice volume, currently 100%' }).props.onClick({
        currentTarget: volumeTriggerNode,
      });
    });

    expect(renderer.root.findAllByProps({ 'data-popout': 'true' })).toHaveLength(1);

    act(() => {
      renderer.unmount();
    });
  });

  it('centers the volume slider thumb on the track centerline', () => {
    renderer = create(renderVoiceAudio());

    openAudioOptions(renderer);

    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Voice volume, currently 100%' }).props.onClick({
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, top: 0, width: 44, height: 44 }),
        },
      });
    });

    const thumb = renderer.root.findByProps({ 'aria-label': 'Voice volume' });
    const thumbStyle = thumb.props.style as React.CSSProperties;
    expect(thumbStyle.marginTop).toBe(-16);
    expect(thumbStyle.transform).toBe('translate(118px, 8px)');

    const trackNode = {
      getBoundingClientRect: () => ({ top: 615, bottom: 621 }),
    };
    const thumbNode = {
      getBoundingClientRect: () => {
        const uncenteredThumbTop = 626;
        const thumbHeight = 16;
        const marginTop =
          typeof thumbStyle.marginTop === 'number'
            ? thumbStyle.marginTop
            : Number.parseFloat(String(thumbStyle.marginTop ?? 0));
        const top = uncenteredThumbTop + marginTop;

        return { top, bottom: top + thumbHeight };
      },
    };
    const getYCenter = (node: { getBoundingClientRect: () => { top: number; bottom: number } }) => {
      const rect = node.getBoundingClientRect();
      return rect.top + (rect.bottom - rect.top) / 2;
    };

    expect(Math.abs(getYCenter(thumbNode) - getYCenter(trackNode))).toBeLessThanOrEqual(1);

    act(() => {
      renderer.unmount();
    });
  });

  it('applies playback rate when the source value changes', () => {
    const store = createStore();
    const audio = createAudioMock();
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice-a',
    };

    act(() => {
      renderer = create(renderVoiceAudio(store), {
        createNodeMock: (element) => (element.type === 'audio' ? audio : null),
      });
    });

    act(() => {
      store.set(voiceMessagePlaybackRateAtom, 1.5);
    });
    audio.playbackRate = 1;

    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice-b',
    };
    act(() => {
      renderer.update(renderVoiceAudio(store));
    });

    expect(audio.playbackRate).toBe(1.5);

    act(() => {
      renderer.unmount();
    });
  });

  it('applies playback rate and volume in the onPlay handler', () => {
    const store = createStore();
    const audio = createAudioMock();
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice',
    };
    act(() => {
      renderer = create(renderVoiceAudio(store), {
        createNodeMock: (element) => (element.type === 'audio' ? audio : null),
      });
    });

    act(() => {
      store.set(voiceMessagePlaybackRateAtom, 2);
      store.set(voiceMessageVolumeAtom, 0);
    });
    audio.playbackRate = 1;
    audio.volume = 1;
    act(() => {
      renderer.root.findByType('audio').props.onPlay();
    });

    expect(audio.playbackRate).toBe(2);
    expect(audio.volume).toBe(0);
    expect(audio.muted).toBe(true);
    expect(audio.webkitPreservesPitch).toBe(true);
    expect(
      renderer.root.findByProps({ 'aria-label': 'Playback speed, currently 2×, click to cycle' })
    ).toBeTruthy();

    act(() => {
      renderer.unmount();
    });
  });

  it('applies playback rate, volume, and play time on loadedmetadata before pending seek handling', () => {
    const store = createStore();
    const audio = createAudioMock();
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice',
    };
    act(() => {
      renderer = create(renderVoiceAudio(store), {
        createNodeMock: (element) => (element.type === 'audio' ? audio : null),
      });
    });

    act(() => {
      store.set(voiceMessagePlaybackRateAtom, 1.5);
      store.set(voiceMessageVolumeAtom, 0.5);
    });
    audio.playbackRate = 1;
    audio.volume = 1;
    audio.currentTime = 3;
    act(() => {
      renderer.root.findByType('audio').props.onLoadedMetadata();
    });

    expect(audio.playbackRate).toBe(1.5);
    expect(audio.volume).toBe(0.5);
    expect(audio.preservesPitch).toBe(true);
    expect(audio.webkitPreservesPitch).toBe(true);
    expect(audio.mozPreservesPitch).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).toContain('0:03 / 0:10');

    act(() => {
      renderer.unmount();
    });
  });

  it('cycles the global playback rate from the visible pill', () => {
    const store = createStore();
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice',
    };
    act(() => {
      renderer = create(renderVoiceAudio(store));
    });

    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
    });

    act(() => {
      renderer.root
        .findAllByProps({ 'aria-label': 'Playback speed, currently 1×, click to cycle' })[0]
        .props.onClick();
    });
    expect(store.get(voiceMessagePlaybackRateAtom)).toBe(1.5);

    act(() => {
      renderer.root
        .findByProps({ 'aria-label': 'Playback speed, currently 1.5×, click to cycle' })
        .props.onClick();
    });
    expect(store.get(voiceMessagePlaybackRateAtom)).toBe(2);

    act(() => {
      renderer.root
        .findByProps({ 'aria-label': 'Playback speed, currently 2×, click to cycle' })
        .props.onClick();
    });
    expect(store.get(voiceMessagePlaybackRateAtom)).toBe(1);

    act(() => {
      renderer.unmount();
    });
  });

  it('updates all mounted voice players and audio elements when one pill changes the rate', () => {
    const store = createStore();
    const audioA = createAudioMock();
    const audioB = createAudioMock();
    const audioMocks = [audioA, audioB];
    let audioIndex = 0;
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice',
    };

    act(() => {
      renderer = create(
        React.createElement(
          Provider,
          { store },
          React.createElement(React.Fragment, null, [
            React.cloneElement(renderVoiceAudioContent({ url: 'mxc://mindroom/voice-a' }), {
              key: 'voice-a',
            }),
            React.cloneElement(renderVoiceAudioContent({ url: 'mxc://mindroom/voice-b' }), {
              key: 'voice-b',
            }),
          ])
        ),
        {
          createNodeMock: (element) => {
            if (element.type !== 'audio') return null;
            const audio = audioMocks[audioIndex];
            audioIndex += 1;
            return audio;
          },
        }
      );
    });

    act(() => {
      renderer.root.findAllByProps({ 'aria-label': 'Play voice message' })[0].props.onClick();
    });
    act(() => {
      renderer.root
        .findAllByProps({ 'aria-label': 'Playback speed, currently 1×, click to cycle' })[0]
        .props.onClick();
    });

    expect(audioA.playbackRate).toBe(1.5);
    expect(audioB.playbackRate).toBe(1.5);
    expect(
      renderer.root.findAllByProps({
        'aria-label': 'Playback speed, currently 1.5×, click to cycle',
      })
    ).toHaveLength(2);

    act(() => {
      renderer.root.findAllByType('audio')[1].props.onPlay();
    });

    expect(
      renderer.root.findAllByProps({
        'aria-label': 'Playback speed, currently 1.5×, click to cycle',
      })
    ).toHaveLength(2);

    act(() => {
      renderer.unmount();
    });
  });

  it('preserves Matrix duration when browser duration is invalid', () => {
    const audio = createAudioMock();
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice',
    };
    renderer = create(renderVoiceAudio(), {
      createNodeMock: (element) => (element.type === 'audio' ? audio : null),
    });

    act(() => {
      mocks.playTimeCallback?.(Number.NaN, 0);
      mocks.playTimeCallback?.(Number.POSITIVE_INFINITY, 0);
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('0:00 / 0:10');

    act(() => {
      renderer.root
        .findByProps({ 'aria-label': 'Seek voice message' })
        .props.onChange({ currentTarget: { value: '50' } });
    });

    expect(audio.currentTime).toBe(5);

    act(() => {
      renderer.unmount();
    });
  });

  it('falls back to browser duration when Matrix duration is missing', () => {
    const audio = createAudioMock();
    audio.duration = 8;
    audio.currentTime = 2;
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice',
    };
    renderer = create(
      renderVoiceAudio(createStore(), { info: { mimetype: 'audio/ogg', duration: undefined } }),
      {
        createNodeMock: (element) => (element.type === 'audio' ? audio : null),
      }
    );

    act(() => {
      renderer.root.findByType('audio').props.onLoadedMetadata();
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('0:02 / 0:08');

    act(() => {
      renderer.unmount();
    });
  });

  it('uses browser-measured duration over an initial Matrix duration', () => {
    const audio = createAudioMock();
    audio.duration = 8.52;
    audio.currentTime = 2;
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice',
    };
    renderer = create(renderVoiceAudio(), {
      createNodeMock: (element) => (element.type === 'audio' ? audio : null),
    });

    act(() => {
      renderer.root.findByType('audio').props.onLoadedMetadata();
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('0:02 / 0:08');

    act(() => {
      renderer.root
        .findByProps({ 'aria-label': 'Seek voice message' })
        .props.onChange({ currentTarget: { value: '100' } });
    });

    expect(audio.currentTime).toBe(8.52);

    act(() => {
      renderer.unmount();
    });
  });

  it('syncs Matrix duration when metadata arrives after the initial render', () => {
    const store = createStore();
    renderer = create(
      renderVoiceAudio(store, { info: { mimetype: 'audio/ogg', duration: undefined } })
    );

    expect(JSON.stringify(renderer.toJSON())).toContain('0:00 / 0:00');

    act(() => {
      renderer.update(renderVoiceAudio(store, { info: { mimetype: 'audio/ogg', duration: 7000 } }));
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('0:00 / 0:07');

    act(() => {
      renderer.unmount();
    });
  });

  it('keeps browser duration when Matrix duration arrives after loaded metadata', () => {
    const store = createStore();
    const audio = createAudioMock();
    audio.duration = 8.52;
    audio.currentTime = 0;
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice',
    };
    renderer = create(
      renderVoiceAudio(store, { info: { mimetype: 'audio/ogg', duration: undefined } }),
      {
        createNodeMock: (element) => (element.type === 'audio' ? audio : null),
      }
    );

    act(() => {
      renderer.root.findByType('audio').props.onLoadedMetadata();
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('0:00 / 0:08');

    act(() => {
      renderer.update(renderVoiceAudio(store, { info: { mimetype: 'audio/ogg', duration: 7000 } }));
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('0:00 / 0:08');
    act(() => {
      renderer.root
        .findByProps({ 'aria-label': 'Seek voice message' })
        .props.onChange({ currentTarget: { value: '100' } });
    });

    expect(audio.currentTime).toBe(8.52);

    act(() => {
      renderer.unmount();
    });
  });

  it('clears the previous duration when media changes to an item without Matrix duration', async () => {
    const store = createStore();
    renderer = create(renderVoiceAudio(store, { url: 'mxc://mindroom/voice-a' }));

    expect(JSON.stringify(renderer.toJSON())).toContain('0:00 / 0:10');

    await act(async () => {
      renderer.update(
        renderVoiceAudio(store, {
          url: 'mxc://mindroom/voice-b',
          info: { mimetype: 'audio/ogg', duration: undefined },
        })
      );
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('0:00 / 0:00');

    act(() => {
      renderer.unmount();
    });
  });

  it('renders fallback waveform bars for missing metadata', () => {
    renderer = create(
      React.createElement(VoiceAudioContent, {
        mimeType: 'audio/ogg',
        url: 'mxc://mindroom/voice',
        info: {
          mimetype: 'audio/ogg',
          duration: 5000,
        },
      })
    );

    expect(renderer.root.findAllByType('rect')).toHaveLength(48);

    act(() => {
      renderer.unmount();
    });
  });
});
