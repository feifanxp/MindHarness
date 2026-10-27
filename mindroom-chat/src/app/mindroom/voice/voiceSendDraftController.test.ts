import { MatrixError } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import type {
  PendingVoiceSendContext,
  PendingVoiceSendDraft,
} from '../../state/room/roomInputDrafts';
import type { CapturedVoiceRecording } from './voiceCaptureSession';
import { createVoiceSendDraftController, type VoiceDraftStore } from './voiceSendDraftController';

const createContext = (roomId = '!voice:example.org'): PendingVoiceSendContext => ({
  ownerSessionId: '@voice:example.org',
  roomId,
  room: { roomId } as PendingVoiceSendContext['room'],
  threadId: '$thread',
  replyDraft: undefined,
  threadingEnabled: true,
  signalBridgedRoom: false,
});

const createRecording = (label = 'voice'): CapturedVoiceRecording => ({
  file: new File([label], `${label}.ogg`, { type: 'audio/ogg' }),
  duration: 640,
  waveform: [3, 17, 42],
});

const createDraft = (label = 'voice'): PendingVoiceSendDraft => ({
  ...createRecording(label),
  context: createContext(),
  errorMessage: 'previous failure',
});

const createDraftStore = (initial?: PendingVoiceSendDraft) => {
  let current = initial;
  const store: VoiceDraftStore = {
    read: () => current,
    write: (draft) => {
      current = draft;
    },
  };
  return store;
};

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('voiceSendDraftController', () => {
  it('sends an initial recording with exact identity and clears durable state on success', async () => {
    const store = createDraftStore(createDraft('older'));
    const controller = createVoiceSendDraftController(store);
    const recording = createRecording();
    const context = createContext();
    const sendRecording = vi.fn();
    const onFailure = vi.fn();

    expect(await controller.sendInitial(recording, context, { sendRecording, onFailure })).toBe(
      true
    );
    expect(sendRecording).toHaveBeenCalledWith(
      recording.file,
      recording.duration,
      recording.waveform,
      context
    );
    expect(store.read()).toBeUndefined();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('parks the exact initial recording and context when delivery fails', async () => {
    const store = createDraftStore();
    const controller = createVoiceSendDraftController(store);
    const recording = createRecording();
    const context = createContext();
    const onFailure = vi.fn();

    expect(
      await controller.sendInitial(recording, context, {
        sendRecording: () => {
          throw new Error('voice upload failed');
        },
        onFailure,
      })
    ).toBe(false);
    expect(store.read()).toEqual({
      file: recording.file,
      duration: recording.duration,
      waveform: recording.waveform,
      context,
      errorMessage: 'voice upload failed',
    });
    expect(store.read()?.file).toBe(recording.file);
    expect(store.read()?.waveform).toBe(recording.waveform);
    expect(store.read()?.context).toBe(context);
    expect(onFailure).toHaveBeenCalledOnce();
  });

  it.each([
    [
      new MatrixError({ errcode: 'M_UNKNOWN', error: '' }),
      "Couldn't send — your connection dropped. Try again.",
    ],
    [new Error('plain transport failure'), 'plain transport failure'],
    [undefined, 'Failed to send voice message.'],
  ])('formats initial delivery error %#', async (error, expectedMessage) => {
    const store = createDraftStore();
    const controller = createVoiceSendDraftController(store);

    await controller.sendInitial(createRecording(), createContext(), {
      sendRecording: () => Promise.reject(error),
      onFailure: vi.fn(),
    });

    expect(store.read()?.errorMessage).toBe(expectedMessage);
  });

  it('stamps retry ownership synchronously and blocks a controller created after remount', async () => {
    const draft = createDraft();
    const store = createDraftStore(draft);
    const controller = createVoiceSendDraftController(store);
    const gate = deferred();
    const claim = vi.fn(() => true);
    const sendRecording = vi.fn(() => gate.promise);
    const onFailure = vi.fn();

    const retry = controller.retry({ claim, sendRecording, onFailure });
    const claimedDraft = store.read()!;
    expect(claimedDraft.inFlight).toBeDefined();
    expect(typeof claimedDraft.inFlight?.token).toBe('string');
    expect(typeof claimedDraft.inFlight?.startedAt).toBe('number');
    expect(claimedDraft.errorMessage).toBeUndefined();
    expect(sendRecording).toHaveBeenCalledWith(
      draft.file,
      draft.duration,
      draft.waveform,
      draft.context
    );

    const otherClaim = vi.fn(() => true);
    const otherSend = vi.fn();
    const remounted = createVoiceSendDraftController(store);
    expect(
      await remounted.retry({ claim: otherClaim, sendRecording: otherSend, onFailure: vi.fn() })
    ).toBe(false);
    expect(otherClaim).not.toHaveBeenCalled();
    expect(otherSend).not.toHaveBeenCalled();

    gate.resolve();
    expect(await retry).toBe(true);
    expect(store.read()).toBeUndefined();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('restores the live matching draft and error after retry failure', async () => {
    const draft = createDraft();
    const store = createDraftStore(draft);
    const controller = createVoiceSendDraftController(store);
    const onFailure = vi.fn();

    expect(
      await controller.retry({
        claim: () => true,
        sendRecording: () => Promise.reject(new Error('retry failed')),
        onFailure,
      })
    ).toBe(false);
    expect(store.read()).toEqual({
      ...draft,
      errorMessage: 'retry failed',
      inFlight: undefined,
    });
    expect(onFailure).toHaveBeenCalledOnce();
  });

  it('surfaces retry claim refusal without invoking delivery', async () => {
    const draft = createDraft();
    const store = createDraftStore(draft);
    const controller = createVoiceSendDraftController(store);
    const sendRecording = vi.fn();
    const onFailure = vi.fn();

    expect(await controller.retry({ claim: () => false, sendRecording, onFailure })).toBe(false);
    expect(store.read()).toEqual({
      ...draft,
      errorMessage: 'Another voice message is still sending. Please wait.',
    });
    expect(sendRecording).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('prevents retry reentry from its synchronous claim callback', async () => {
    const store = createDraftStore(createDraft());
    const controller = createVoiceSendDraftController(store);
    const sendRecording = vi.fn();
    const nestedSend = vi.fn();
    const nestedClaim = vi.fn(() => true);
    let nestedRetry!: Promise<boolean>;
    const claim = vi.fn(() => {
      nestedRetry = controller.retry({
        claim: nestedClaim,
        sendRecording: nestedSend,
        onFailure: vi.fn(),
      });
      return true;
    });

    expect(await controller.retry({ claim, sendRecording, onFailure: vi.fn() })).toBe(true);
    expect(await nestedRetry).toBe(false);
    expect(claim).toHaveBeenCalledOnce();
    expect(nestedClaim).not.toHaveBeenCalled();
    expect(sendRecording).toHaveBeenCalledOnce();
    expect(nestedSend).not.toHaveBeenCalled();
  });

  it('does not resurrect a draft discarded synchronously by an accepted claim', async () => {
    const store = createDraftStore(createDraft());
    const controller = createVoiceSendDraftController(store);
    const sendRecording = vi.fn();
    const onFailure = vi.fn();

    expect(
      await controller.retry({
        claim: () => {
          store.write(undefined);
          return true;
        },
        sendRecording,
        onFailure,
      })
    ).toBe(false);
    expect(store.read()).toBeUndefined();
    expect(sendRecording).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledOnce();
  });

  it('does not send after a synchronous store observer replaces its stamped draft', async () => {
    const original = createDraft();
    const replacement = createDraft('replacement');
    let current: PendingVoiceSendDraft | undefined = original;
    let replaceOnStamp = true;
    const store: VoiceDraftStore = {
      read: () => current,
      write: (draft) => {
        current = draft;
        if (replaceOnStamp && draft?.inFlight) {
          replaceOnStamp = false;
          current = replacement;
        }
      },
    };
    const controller = createVoiceSendDraftController(store);
    const sendRecording = vi.fn();
    const onFailure = vi.fn();

    expect(await controller.retry({ claim: () => true, sendRecording, onFailure })).toBe(false);
    expect(store.read()).toBe(replacement);
    expect(sendRecording).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledOnce();
  });

  it('preserves a replacement draft when a stale retry succeeds', async () => {
    const store = createDraftStore(createDraft());
    const controller = createVoiceSendDraftController(store);
    const replacement = createDraft('replacement');

    expect(
      await controller.retry({
        claim: () => true,
        sendRecording: () => {
          store.write(replacement);
        },
        onFailure: vi.fn(),
      })
    ).toBe(true);
    expect(store.read()).toBe(replacement);
  });

  it('preserves a replacement draft without failure notification when a stale retry rejects', async () => {
    const store = createDraftStore(createDraft());
    const controller = createVoiceSendDraftController(store);
    const replacement = createDraft('replacement');
    const onFailure = vi.fn();

    expect(
      await controller.retry({
        claim: () => true,
        sendRecording: () => {
          store.write(replacement);
          throw new Error('stale failure');
        },
        onFailure,
      })
    ).toBe(false);
    expect(store.read()).toBe(replacement);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('keeps explicit discard authoritative while deferred retry rejects', async () => {
    const store = createDraftStore(createDraft());
    const controller = createVoiceSendDraftController(store);
    const gate = deferred();
    const onFailure = vi.fn();
    const retry = controller.retry({
      claim: () => true,
      sendRecording: () => gate.promise,
      onFailure,
    });

    controller.discardPending();
    gate.reject(new Error('failed'));

    expect(await retry).toBe(false);
    expect(store.read()).toBeUndefined();
    expect(onFailure).not.toHaveBeenCalled();
  });
});
