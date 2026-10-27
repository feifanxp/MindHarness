import React, { createRef, useState } from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Room } from 'matrix-js-sdk';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceRecorderComposer, VoiceRecorderComposerHandle } from './VoiceRecorderDialog';
import type { PendingVoiceSendContext } from '../../state/room/roomInputDrafts';

const TEST_ROOM_ID = '!room:example.org';

const createTestSendContext = (): PendingVoiceSendContext => ({
  ownerSessionId: '@me:example.org',
  roomId: TEST_ROOM_ID,
  room: { roomId: TEST_ROOM_ID, name: TEST_ROOM_ID } as unknown as Room,
  threadId: undefined,
  replyDraft: undefined,
  threadingEnabled: true,
  signalBridgedRoom: false,
});

const renderInProvider = (element: React.ReactElement) =>
  React.createElement(Provider, { store: createStore() }, element);

type Listener = (event: Event) => void;

class MockMediaStreamTrack {
  stop = vi.fn();
}

class MockMediaStream {
  track = new MockMediaStreamTrack();

  getTracks() {
    return [this.track];
  }
}

class MockMediaRecorder {
  static isTypeSupported = vi.fn(() => true);

  state: RecordingState = 'inactive';

  mimeType = 'audio/ogg;codecs=opus';

  private listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (!listener) return;
    const fn =
      typeof listener === 'function' ? listener : (event: Event) => listener.handleEvent(event);
    const current = this.listeners.get(type) ?? new Set<Listener>();
    current.add(fn);
    this.listeners.set(type, current);
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    this.listeners.get('dataavailable')?.forEach((listener) =>
      listener({
        data: new Blob(['voice'], { type: this.mimeType }),
      } as BlobEvent)
    );
    this.listeners.get('stop')?.forEach((listener) => listener(new Event('stop')));
  }
}

const setupSupportedRecorder = () => {
  vi.stubGlobal('window', {
    isSecureContext: true,
  });
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn(async () => new MockMediaStream()),
    },
  });
  vi.stubGlobal('MediaRecorder', MockMediaRecorder);
};

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
    Button,
    Dialog: Wrapper,
    Icon: (props: Record<string, unknown>) => React.createElement('span', props),
    IconButton: Button,
    Icons: new Proxy(
      {},
      {
        get: (_target, key) => String(key),
      }
    ),
    Line: Wrapper,
    Overlay: ({ children, open }: { children?: React.ReactNode; open?: boolean }) =>
      open ? React.createElement('div', null, children) : null,
    OverlayBackdrop: Wrapper,
    OverlayCenter: Wrapper,
    Spinner: (props: Record<string, unknown>) => React.createElement('span', props),
    Text: Wrapper,
    // Icon buttons name themselves in tooltips; render only the trigger.
    Tooltip: () => null,
    TooltipProvider: ({ children }: { children: (triggerRef: () => void) => React.ReactNode }) =>
      children(() => undefined),
    config: {
      space: new Proxy(
        {},
        {
          get: () => '0px',
        }
      ),
    },
  };
});

// FocusTrap from focus-trap-react needs DOM focus management that
// react-test-renderer doesn't provide. The real library: (a) snapshots the
// `onDeactivate` callback at first mount and invokes it on every trap
// teardown (including unmount), and (b) calls `clickOutsideDeactivates` and
// `escapeDeactivates` per-event during event handling. Model BOTH so tests
// can distinguish user-defer intent (predicates) from teardown
// (onDeactivate) — that distinction is the load-bearing assumption of
// VoiceRecorderDialog's defer-dismissal feature.
type FocusTrapOptionsCapture = {
  onDeactivate?: () => void;
  clickOutsideDeactivates?: ((event: MouseEvent) => boolean) | boolean;
  escapeDeactivates?: ((event: KeyboardEvent) => boolean) | boolean;
};
const focusTrapState: {
  // Always reflects the options of the most recently mounted trap.
  latest?: FocusTrapOptionsCapture;
} = {};
vi.mock('focus-trap-react', () => {
  const FocusTrapMock: React.FC<{
    children: React.ReactNode;
    focusTrapOptions?: FocusTrapOptionsCapture;
  }> = ({ children, focusTrapOptions }) => {
    // Snapshot at mount, just like the real library.
    const initialOptionsRef = React.useRef(focusTrapOptions);
    focusTrapState.latest = focusTrapOptions;
    React.useEffect(
      () => () => {
        // Unmount fires the SNAPSHOT-time onDeactivate, matching the real
        // focus-trap-react closure-capture semantics. Tests rely on this
        // to verify that VoiceRecorderDialog does not depend on
        // onDeactivate for defer intent.
        initialOptionsRef.current?.onDeactivate?.();
      },
      []
    );
    return React.createElement('div', null, children);
  };
  return { default: FocusTrapMock };
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

vi.mock('../../utils/dom', () => ({
  pauseAllMediaElements: vi.fn(),
}));

function OverviewHarness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);

  if (!open) {
    return React.createElement('div', null, 'closed');
  }

  return React.createElement(VoiceRecorderComposer, {
    active: open,
    onClose: () => {
      onClose();
      setOpen(false);
    },
    onRetryRequest: vi.fn(),
    onSendRecording: vi.fn(),
    getSendContext: createTestSendContext,
  });
}

describe('VoiceRecorderComposer', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      isSecureContext: true,
    });
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('MediaRecorder', undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps an overview recorder error visible until the user dismisses it', async () => {
    const onClose = vi.fn();
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(renderInProvider(React.createElement(OverviewHarness, { onClose })));
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer.toJSON())).toContain('Voice Recording Error');
    expect(JSON.stringify(renderer.toJSON())).toContain(
      'Voice recording is not supported in this browser.'
    );

    const okButton = renderer.root
      .findAllByType('button')
      .find((button) => button.props.children === 'OK');
    expect(okButton).toBeTruthy();

    await act(async () => {
      okButton?.props.onClick();
    });

    expect(onClose).toHaveBeenCalledOnce();
    expect(JSON.stringify(renderer.toJSON())).toContain('closed');

    renderer.unmount();
  });

  it('shows retry-first upload failure controls and keeps the capsule mounted', async () => {
    setupSupportedRecorder();
    const onClose = vi.fn();
    const onRetryRequest = vi.fn();
    const onSendRecording = vi.fn().mockRejectedValueOnce(new Error('upload failed'));
    const recorderRef = createRef<VoiceRecorderComposerHandle>();
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        renderInProvider(
          React.createElement(VoiceRecorderComposer, {
            ref: recorderRef,
            active: true,
            onClose,
            onRetryRequest,
            onSendRecording,
            getSendContext: createTestSendContext,
          })
        )
      );
    });

    await act(async () => {
      await recorderRef.current?.send();
    });

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain('Voice send failed');
    expect(rendered).toContain('upload failed');
    expect(rendered).toContain('Your recording is still saved.');
    expect(rendered).toContain('Retry');
    expect(rendered).toContain('Discard');
    expect(
      renderer.root.findAllByProps({ 'aria-label': 'Retry sending voice recording' })
    ).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();

    const retryButton = renderer.root
      .findAllByType('button')
      .find((button) => button.props.children === 'Retry');
    await act(async () => {
      retryButton?.props.onClick();
    });
    expect(onRetryRequest).toHaveBeenCalledOnce();
    expect(onSendRecording).toHaveBeenCalledOnce();

    renderer.unmount();
  });

  it('confirms before discarding a pending failed recording', async () => {
    setupSupportedRecorder();
    const onClose = vi.fn();
    const onSendRecording = vi.fn().mockRejectedValueOnce(new Error('upload failed'));
    const recorderRef = createRef<VoiceRecorderComposerHandle>();
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        renderInProvider(
          React.createElement(VoiceRecorderComposer, {
            ref: recorderRef,
            active: true,
            onClose,
            onRetryRequest: vi.fn(),
            onSendRecording,
            getSendContext: createTestSendContext,
          })
        )
      );
    });

    await act(async () => {
      await recorderRef.current?.send();
    });

    const findRetryDialogDiscard = () =>
      renderer.root.findAllByType('button').find((button) => button.props.children === 'Discard');
    await act(async () => {
      findRetryDialogDiscard()?.props.onClick();
    });

    expect(onClose).not.toHaveBeenCalled();
    const afterFirstDiscard = JSON.stringify(renderer.toJSON());
    // The retry overlay must hide while the discard confirmation is open so
    // the dialogs do not visually stack.
    expect(afterFirstDiscard).not.toContain('Voice send failed');
    expect(afterFirstDiscard).toContain('Discard voice recording?');
    expect(afterFirstDiscard).toContain(
      'This recording has not been sent. Discard it permanently?'
    );

    const cancelButton = renderer.root
      .findAllByType('button')
      .find((button) => button.props.children === 'Cancel');
    await act(async () => {
      cancelButton?.props.onClick();
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('Voice send failed');

    await act(async () => {
      findRetryDialogDiscard()?.props.onClick();
    });
    const confirmDiscard = renderer.root
      .findAllByType('button')
      .filter((button) => button.props.children === 'Discard')
      .at(-1);
    await act(async () => {
      confirmDiscard?.props.onClick();
    });

    expect(onClose).toHaveBeenCalledOnce();

    renderer.unmount();
  });

  it('defers (hides) the failure overlay on backdrop click without discarding the draft', async () => {
    // rev-H Issue 6 (R3) + R4 MAJOR: the defer signal must come from the
    // per-event clickOutsideDeactivates predicate, not from the trap's
    // onDeactivate (which fires on every teardown including Retry/Discard).
    setupSupportedRecorder();
    const onClose = vi.fn();
    const onSendRecording = vi.fn().mockRejectedValueOnce(new Error('upload failed'));
    const recorderRef = createRef<VoiceRecorderComposerHandle>();
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        renderInProvider(
          React.createElement(VoiceRecorderComposer, {
            ref: recorderRef,
            active: true,
            onClose,
            onRetryRequest: vi.fn(),
            onSendRecording,
            getSendContext: createTestSendContext,
          })
        )
      );
    });

    await act(async () => {
      await recorderRef.current?.send();
    });

    // Failure overlay is open and FocusTrap captured its predicate.
    expect(JSON.stringify(renderer.toJSON())).toContain('Voice send failed');
    const clickOutside = focusTrapState.latest?.clickOutsideDeactivates;
    expect(clickOutside).toBeTypeOf('function');

    // Simulate user clicking the backdrop.
    let returned: boolean | undefined;
    await act(async () => {
      if (typeof clickOutside === 'function') {
        returned = clickOutside({} as MouseEvent);
      }
    });
    expect(returned).toBe(true);

    const afterDefer = JSON.stringify(renderer.toJSON());
    // Overlay hidden but capsule still visible — draft is preserved.
    expect(afterDefer).not.toContain('Voice send failed');
    expect(afterDefer).toContain('Capsule');
    expect(onClose).not.toHaveBeenCalled();

    renderer.unmount();
  });

  it('does NOT mark the error as deferred when FocusTrap unmounts for Discard / Retry transitions', async () => {
    // R4 EXTREME-CONVERGENCE MAJOR (8/8 reviewers): focus-trap-react snapshots
    // onDeactivate at first mount and invokes it on every teardown, including
    // the unmount that happens when Retry/Discard flips showPendingSendError
    // to false. The previous wiring used onDeactivate as the defer signal,
    // so the closure with stale `discardConfirmationOpen=false` would defer
    // the message. After Cancel, the overlay would never re-appear.
    //
    // The new wiring drops onDeactivate entirely. This test simulates the
    // exact bug scenario: Discard click → trap unmounts → fires (snapshot)
    // onDeactivate → Cancel from confirmation → overlay must re-show.
    setupSupportedRecorder();
    const onSendRecording = vi.fn().mockRejectedValueOnce(new Error('upload failed'));
    const recorderRef = createRef<VoiceRecorderComposerHandle>();
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        renderInProvider(
          React.createElement(VoiceRecorderComposer, {
            ref: recorderRef,
            active: true,
            onClose: vi.fn(),
            onRetryRequest: vi.fn(),
            onSendRecording,
            getSendContext: createTestSendContext,
          })
        )
      );
    });

    await act(async () => {
      await recorderRef.current?.send();
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('Voice send failed');

    // Click Discard inside the failure overlay → opens confirmation; trap
    // unmounts and the mock fires the (snapshot) onDeactivate just like the
    // real library does. Under the BUG, this would call the defer code and
    // record errorMessage as deferred.
    const discardInOverlay = renderer.root
      .findAllByType('button')
      .find((b) => b.props.children === 'Discard');
    await act(async () => {
      discardInOverlay?.props.onClick();
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('Discard voice recording?');

    // Cancel the discard confirmation. The retry overlay must re-appear.
    const cancelButton = renderer.root
      .findAllByType('button')
      .find((b) => b.props.children === 'Cancel');
    await act(async () => {
      cancelButton?.props.onClick();
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('Voice send failed');

    renderer.unmount();
  });

  it('re-shows the failure overlay when an explicit Retry fails again with the same message', async () => {
    // R4 MAJOR (rev-B Issue 1, rev-G Issue 1): if the user has previously
    // deferred and then explicitly Retries from the capsule, a same-message
    // failure must re-surface the overlay rather than getting silently hidden
    // by stale defer state. beginRetry() clears deferredErrorMessage before
    // calling retry().
    setupSupportedRecorder();
    const message = 'upload failed';
    const onSendRecording = vi
      .fn()
      .mockRejectedValueOnce(new Error(message))
      .mockRejectedValueOnce(new Error(message));
    const recorderRef = createRef<VoiceRecorderComposerHandle>();
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        renderInProvider(
          React.createElement(VoiceRecorderComposer, {
            ref: recorderRef,
            active: true,
            onClose: vi.fn(),
            onRetryRequest: vi.fn(),
            onSendRecording,
            getSendContext: createTestSendContext,
          })
        )
      );
    });

    await act(async () => {
      await recorderRef.current?.send();
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('Voice send failed');

    // User defers via backdrop click predicate.
    const clickOutside = focusTrapState.latest?.clickOutsideDeactivates;
    await act(async () => {
      if (typeof clickOutside === 'function') {
        clickOutside({} as MouseEvent);
      }
    });
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Voice send failed');

    // User clicks primary composer Send again.
    await act(async () => {
      await recorderRef.current?.send();
    });

    // Same-message failure must re-surface the overlay.
    expect(JSON.stringify(renderer.toJSON())).toContain('Voice send failed');
    expect(onSendRecording).toHaveBeenCalledTimes(2);

    renderer.unmount();
  });
});
