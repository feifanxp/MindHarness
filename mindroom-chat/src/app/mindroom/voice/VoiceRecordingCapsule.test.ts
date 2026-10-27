import React from 'react';
import { act, create } from 'react-test-renderer';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { createFallbackWaveform } from '../../utils/audioWaveform';
import { VoiceRecordingCapsule } from './VoiceRecordingCapsule';

vi.mock('folds', () => {
  const Wrapper = ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('div', props, children);
  const Button = React.forwardRef<
    HTMLButtonElement,
    { children?: React.ReactNode; onClick?: () => void }
  >(({ children, onClick, ...props }, ref) =>
    React.createElement('button', { ...props, onClick, ref }, children)
  );

  return {
    Box: Wrapper,
    Icon: (props: Record<string, unknown>) => React.createElement('span', props),
    IconButton: Button,
    Icons: new Proxy(
      {},
      {
        get: (_target, key) => String(key),
      }
    ),
    Spinner: (props: Record<string, unknown>) => React.createElement('span', props),
    Text: Wrapper,
    // Icon buttons name themselves in tooltips; render only the trigger.
    Tooltip: () => null,
    TooltipProvider: ({ children }: { children: (triggerRef: () => void) => React.ReactNode }) =>
      children(() => undefined),
  };
});

vi.mock('./VoiceRecordingCapsule.css', () => ({
  Capsule: 'Capsule',
  HiddenStatus: 'HiddenStatus',
  Timer: 'Timer',
}));

vi.mock('../../components/voice/VoiceWaveform.css', () => ({
  Bar: 'Bar',
  BarActive: 'BarActive',
  BarCompact: 'BarCompact',
  BarCompactUnrecorded: 'BarCompactUnrecorded',
  Svg: 'Svg',
  SvgCompact: 'SvgCompact',
  Waveform: 'Waveform',
  WaveformCompact: 'WaveformCompact',
  WaveformDimmed: 'WaveformDimmed',
  WaveformSeek: 'WaveformSeek',
}));

describe('VoiceRecordingCapsule', () => {
  it('updates visible and accessible status when the active language changes', async () => {
    const language = createInstance();
    await language.init({
      lng: 'en',
      fallbackLng: 'en',
      initImmediate: false,
      resources: {
        en: {
          translation: {
            mindroomUi: {
              voice: {
                discardRecording: 'Discard voice recording',
                pauseRecording: 'Pause voice recording',
                statusActive: 'Voice recording active',
              },
            },
          },
        },
        de: {
          translation: {
            mindroomUi: {
              voice: {
                discardRecording: 'Sprachaufnahme verwerfen',
                pauseRecording: 'Sprachaufnahme pausieren',
                statusActive: 'Sprachaufnahme aktiv',
              },
            },
          },
        },
      },
    });

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(
          I18nextProvider,
          { i18n: language },
          React.createElement(VoiceRecordingCapsule, {
            phase: 'recording',
            elapsedMs: 12000,
            waveform: createFallbackWaveform(),
            canPause: true,
            onDiscard: vi.fn(),
            onPause: vi.fn(),
            onResume: vi.fn(),
          })
        )
      );
    });

    expect(
      renderer!.root.findAllByType('button').map((button) => button.props['aria-label'])
    ).toEqual(['Discard voice recording', 'Pause voice recording']);
    expect(JSON.stringify(renderer!.toJSON())).toContain('Voice recording active');

    await act(async () => {
      await language.changeLanguage('de');
    });

    expect(
      renderer!.root.findAllByType('button').map((button) => button.props['aria-label'])
    ).toEqual(['Sprachaufnahme verwerfen', 'Sprachaufnahme pausieren']);
    expect(JSON.stringify(renderer!.toJSON())).toContain('Sprachaufnahme aktiv');

    renderer!.unmount();
  });

  it('renders only discard, waveform, timer, and pause controls', () => {
    const renderer = create(
      React.createElement(VoiceRecordingCapsule, {
        phase: 'recording',
        elapsedMs: 12000,
        waveform: createFallbackWaveform(),
        canPause: true,
        onDiscard: vi.fn(),
        onPause: vi.fn(),
        onResume: vi.fn(),
      })
    );

    const buttons = renderer.root.findAllByType('button');
    expect(buttons.map((button) => button.props['aria-label'])).toEqual([
      'Discard voice recording',
      'Pause voice recording',
    ]);
    expect(renderer.toJSON()).toEqual(expect.not.stringContaining('Add to uploads'));
    expect(renderer.toJSON()).toEqual(expect.not.stringContaining('Record again'));
    expect(renderer.root.findAllByType('rect')).toHaveLength(48);

    renderer.unmount();
  });

  it('toggles pause/resume and calls discard handler', () => {
    const onDiscard = vi.fn();
    const onPause = vi.fn();
    const onResume = vi.fn();
    const renderer = create(
      React.createElement(VoiceRecordingCapsule, {
        phase: 'paused',
        elapsedMs: 3000,
        waveform: createFallbackWaveform(),
        canPause: true,
        onDiscard,
        onPause,
        onResume,
      })
    );

    const buttons = renderer.root.findAllByType('button');
    expect(buttons[1].props['aria-label']).toBe('Resume voice recording');

    act(() => {
      buttons[0].props.onClick();
      buttons[1].props.onClick();
    });

    expect(onDiscard).toHaveBeenCalledOnce();
    expect(onResume).toHaveBeenCalledOnce();
    expect(onPause).not.toHaveBeenCalled();

    renderer.unmount();
  });

  it('disables discard while a send stop is processing', () => {
    const renderer = create(
      React.createElement(VoiceRecordingCapsule, {
        phase: 'processing',
        elapsedMs: 3000,
        waveform: createFallbackWaveform(),
        canPause: true,
        onDiscard: vi.fn(),
        onPause: vi.fn(),
        onResume: vi.fn(),
      })
    );

    const discardButton = renderer.root.findByProps({
      'aria-label': 'Discard voice recording',
    });
    expect(discardButton.props.disabled).toBe(true);

    renderer.unmount();
  });

  it('keeps a pending recording ready for primary composer Send', () => {
    const onDiscard = vi.fn();
    const onPause = vi.fn();
    const renderer = create(
      React.createElement(VoiceRecordingCapsule, {
        phase: 'idle',
        elapsedMs: 4200,
        waveform: createFallbackWaveform(),
        canPause: true,
        hasPendingSend: true,
        onDiscard,
        onPause,
        onResume: vi.fn(),
      })
    );

    const buttons = renderer.root.findAllByType('button');
    expect(buttons.map((button) => button.props['aria-label'])).toEqual([
      'Discard voice recording',
      'Pause voice recording',
    ]);
    expect(buttons[1].props.disabled).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).toContain('Voice recording ready to retry');

    act(() => {
      buttons[0].props.onClick();
    });

    expect(onDiscard).toHaveBeenCalledOnce();
    expect(onPause).not.toHaveBeenCalled();

    renderer.unmount();
  });
});
