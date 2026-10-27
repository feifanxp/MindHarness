import { isNativeApp } from '../native/nativeSso';
import {
  createFallbackWaveform,
  normalizeMatrixWaveform,
  timeDomainDataToWaveformPoint,
} from '../../utils/audioWaveform';
import { pauseAllMediaElements } from '../../utils/dom';
import {
  DEFAULT_VOICE_RECORDER_MIME_TYPE,
  getAudioFileExtension,
  getSupportedRecorderMimeType,
} from './voiceRecorderMime';
import { getMicrophoneAccessErrorMessage } from './microphoneAccess';
import { publishVoiceCaptureState, releaseVoiceCaptureState } from './voiceCaptureDiagnostics';

export const VOICE_RECORDER_AUDIO_BITS_PER_SECOND = 32_000;
export const VOICE_RECORDER_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  sampleRate: 24_000,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

const now = (): number => Date.now();

const getAudioContextConstructor = (): typeof AudioContext | undefined => {
  if (typeof window === 'undefined') return undefined;

  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
};

const getInsecureContextVoiceRecorderMessage = (): string =>
  'Voice recording requires HTTPS (or localhost). Open MindRoom over HTTPS.';

export const getVoiceRecorderErrorMessage = (err: unknown): string => {
  if (typeof window !== 'undefined' && !window.isSecureContext && !isNativeApp()) {
    return getInsecureContextVoiceRecorderMessage();
  }
  return getMicrophoneAccessErrorMessage(err);
};

export type VoiceCapturePhase = 'idle' | 'requesting' | 'recording' | 'paused' | 'processing';
export type CapturedVoiceRecording = {
  file: File;
  duration: number;
  waveform: number[] | undefined;
};
export type VoiceCaptureResult =
  | { status: 'captured'; recording: CapturedVoiceRecording }
  | { status: 'failed' }
  | { status: 'ignored' };
export type VoiceCaptureSnapshot = {
  phase: VoiceCapturePhase;
  elapsedMs: number;
  waveform: number[];
  canPause: boolean;
  errorMessage: string | undefined;
};
export type VoiceCaptureSession = {
  getSnapshot: () => VoiceCaptureSnapshot;
  subscribe: (listener: () => void) => () => void;
  start: () => Promise<boolean>;
  canStop: () => boolean;
  pause: () => boolean;
  resume: () => boolean;
  finish: () => Promise<VoiceCaptureResult>;
  discard: () => Promise<boolean>;
  reset: () => void;
  clearError: () => void;
  releaseOwner: () => void;
};

type Generation = {
  acceptsEvents: boolean;
  recorder?: MediaRecorder;
  stream?: MediaStream;
  audioContext?: AudioContext;
  source?: MediaStreamAudioSourceNode;
  analyser?: AnalyserNode;
  buffer?: Uint8Array;
  timer?: ReturnType<typeof setInterval>;
  sampleTimer?: ReturnType<typeof setInterval>;
  chunks: Blob[];
  samples: number[];
  elapsedMs: number;
  startedAt?: number;
  action?: 'send' | 'discard';
  resolve?: (result: VoiceCaptureResult) => void;
  detach?: () => void;
};

const freezeSnapshot = (snapshot: VoiceCaptureSnapshot): VoiceCaptureSnapshot =>
  Object.freeze({ ...snapshot, waveform: Object.freeze([...snapshot.waveform]) as number[] });
const idleSnapshot = (): VoiceCaptureSnapshot =>
  freezeSnapshot({
    phase: 'idle',
    elapsedMs: 0,
    waveform: createFallbackWaveform(),
    canPause: true,
    errorMessage: undefined,
  });

export const createVoiceCaptureSession = (): VoiceCaptureSession => {
  const source = Symbol('voice-recorder');
  const listeners = new Set<() => void>();
  let snapshot = idleSnapshot();
  let current: Generation | undefined;
  let released = false;

  const owns = (generation: Generation) =>
    !released && current === generation && generation.acceptsEvents;
  // A subscriber can accept a stop without replacing the generation.
  const isRecording = (generation: Generation) =>
    owns(generation) && !generation.action && generation.recorder?.state === 'recording';

  const publish = (changes: Partial<VoiceCaptureSnapshot>) => {
    if (released) return;
    snapshot = freezeSnapshot({ ...snapshot, ...changes });
    if (changes.phase)
      publishVoiceCaptureState(source, changes.phase === 'idle' ? 'inactive' : changes.phase);
    listeners.forEach((listener) => listener());
  };
  const elapsed = (generation: Generation) =>
    generation.elapsedMs +
    (generation.startedAt === undefined ? 0 : Math.max(0, now() - generation.startedAt));
  const clearTimers = (generation: Generation) => {
    if (generation.timer !== undefined) clearInterval(generation.timer);
    if (generation.sampleTimer !== undefined) clearInterval(generation.sampleTimer);
    generation.timer = undefined;
    generation.sampleTimer = undefined;
  };
  const closeAudio = (generation: Generation) => {
    try {
      generation.source?.disconnect();
    } catch {
      /* Already disconnected. */
    }
    generation.source = undefined;
    generation.analyser = undefined;
    generation.buffer = undefined;
    const context = generation.audioContext;
    generation.audioContext = undefined;
    if (context && context.state !== 'closed') {
      try {
        void context.close().catch(() => undefined);
      } catch {
        /* Best-effort native cleanup. */
      }
    }
  };
  const releaseResources = (generation: Generation) => {
    clearTimers(generation);
    closeAudio(generation);
    const stream = generation.stream;
    generation.stream = undefined;
    stream?.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        /* Release other tracks too. */
      }
    });
    generation.startedAt = undefined;
  };
  const retire = (generation: Generation) => {
    generation.acceptsEvents = false;
    generation.detach?.();
    generation.detach = undefined;
    if (generation.recorder && generation.recorder.state !== 'inactive') {
      try {
        generation.recorder.stop();
      } catch {
        /* Tracks still release below. */
      }
    }
    releaseResources(generation);
    generation.recorder = undefined;
    generation.chunks = [];
    generation.samples = [];
    generation.resolve?.({ status: 'ignored' });
    generation.resolve = undefined;
  };
  const reset = () => {
    const generation = current;
    current = undefined;
    if (generation) retire(generation);
    publish(idleSnapshot());
  };
  const sample = (generation: Generation) => {
    if (
      current !== generation ||
      !generation.acceptsEvents ||
      !generation.analyser ||
      !generation.buffer
    )
      return;
    generation.analyser.getByteTimeDomainData(generation.buffer);
    generation.samples.push(timeDomainDataToWaveformPoint(generation.buffer));
    if (generation.samples.length > 1200)
      generation.samples.splice(0, generation.samples.length - 1200);
    publish({ waveform: generation.samples });
  };
  const startTimers = (generation: Generation) => {
    clearTimers(generation);
    generation.timer = setInterval(() => {
      if (current === generation)
        publish({ elapsedMs: Math.max(0, Math.round(elapsed(generation))) });
    }, 200);
    if (generation.analyser && generation.buffer) {
      generation.sampleTimer = setInterval(() => sample(generation), 80);
      sample(generation);
    }
  };
  const setupAnalyser = (generation: Generation, stream: MediaStream) => {
    const Constructor = getAudioContextConstructor();
    if (!Constructor) return;
    try {
      const context = new Constructor();
      generation.audioContext = context;
      generation.source = context.createMediaStreamSource(stream);
      generation.analyser = context.createAnalyser();
      generation.analyser.fftSize = 2048;
      generation.source.connect(generation.analyser);
      generation.buffer = new Uint8Array(generation.analyser.fftSize);
      if (context.state === 'suspended') void context.resume().catch(() => undefined);
    } catch {
      closeAudio(generation);
    }
  };
  const finishStop = (
    generation: Generation,
    recorder: MediaRecorder,
    mimeType: string | undefined
  ) => {
    if (!generation.acceptsEvents) return;
    generation.acceptsEvents = false;
    generation.detach?.();
    generation.detach = undefined;
    releaseResources(generation);
    generation.recorder = undefined;
    const resolve = generation.resolve;
    generation.resolve = undefined;
    const isCurrent = current === generation;
    const update = (changes: Partial<VoiceCaptureSnapshot>) => {
      if (isCurrent) publish(changes);
    };
    if (generation.action !== 'send') {
      update({
        phase: 'idle',
        elapsedMs: 0,
        waveform: createFallbackWaveform(),
        ...(generation.action === 'discard'
          ? {}
          : { errorMessage: 'Voice recording stopped unexpectedly. Please record again.' }),
      });
      generation.chunks = [];
      generation.samples = [];
      resolve?.({ status: 'ignored' });
      return;
    }
    if (generation.chunks.length === 0) {
      update({ phase: 'idle', errorMessage: 'No audio data was captured.' });
      generation.samples = [];
      resolve?.({ status: 'failed' });
      return;
    }
    const chunkMimeType = generation.chunks.find((chunk) => chunk.type)?.type;
    const outputMimeType =
      recorder.mimeType || mimeType || chunkMimeType || DEFAULT_VOICE_RECORDER_MIME_TYPE;
    const blob = new Blob(generation.chunks, { type: outputMimeType });
    const duration = Math.max(1, Math.round(generation.elapsedMs));
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = new File(
      [blob],
      'voice-message-' + timestamp + '.' + getAudioFileExtension(outputMimeType),
      { type: outputMimeType }
    );
    const waveform =
      generation.samples.length > 0 ? normalizeMatrixWaveform(generation.samples) : undefined;
    generation.chunks = [];
    generation.samples = [];
    // The facade retains processing until delivery begins; capture diagnostics end here.
    if (isCurrent && !released) releaseVoiceCaptureState(source);
    resolve?.({ status: 'captured', recording: { file, duration, waveform } });
  };
  const start = async () => {
    if (!released && (snapshot.phase !== 'idle' || current?.acceptsEvents)) return false;
    released = false;
    if (current) retire(current);
    const generation: Generation = { acceptsEvents: true, chunks: [], samples: [], elapsedMs: 0 };
    current = generation;
    publish({ errorMessage: undefined });
    if (!owns(generation)) return false;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      current = undefined;
      retire(generation);
      publish({ errorMessage: 'Voice recording is not supported in this browser.' });
      return false;
    }
    if (typeof window !== 'undefined' && !window.isSecureContext && !isNativeApp()) {
      current = undefined;
      retire(generation);
      publish({ errorMessage: getInsecureContextVoiceRecorderMessage() });
      return false;
    }
    pauseAllMediaElements();
    publish({ ...idleSnapshot(), phase: 'requesting' });
    if (!owns(generation)) return false;
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: VOICE_RECORDER_AUDIO_CONSTRAINTS,
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'OverconstrainedError') {
          if (!owns(generation)) return false;
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } else throw err;
      }
      if (!owns(generation)) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      generation.stream = stream;
      const mimeType = getSupportedRecorderMimeType();
      const options: MediaRecorderOptions = {
        audioBitsPerSecond: VOICE_RECORDER_AUDIO_BITS_PER_SECOND,
      };
      if (mimeType) options.mimeType = mimeType;
      const recorder = new MediaRecorder(stream, options);
      generation.recorder = recorder;
      publish({
        canPause: typeof recorder.pause === 'function' && typeof recorder.resume === 'function',
      });
      if (!owns(generation)) return false;
      setupAnalyser(generation, stream);
      const onData = (event: BlobEvent) => {
        if (generation.acceptsEvents && event.data.size > 0) generation.chunks.push(event.data);
      };
      const onStop = () => finishStop(generation, recorder, mimeType);
      recorder.addEventListener('dataavailable', onData);
      recorder.addEventListener('stop', onStop);
      generation.detach = () => {
        recorder.removeEventListener?.('dataavailable', onData);
        recorder.removeEventListener?.('stop', onStop);
      };
      recorder.start();
      generation.startedAt = now();
      startTimers(generation);
      if (!isRecording(generation)) return false;
      publish({ phase: 'recording' });
      return isRecording(generation);
    } catch (err) {
      if (current === generation) {
        current = undefined;
        retire(generation);
        publish({ phase: 'idle', elapsedMs: 0, errorMessage: getVoiceRecorderErrorMessage(err) });
      }
      return false;
    }
  };
  const canStop = () =>
    !!current &&
    !current.action &&
    (current.recorder?.state === 'recording' || current.recorder?.state === 'paused');
  const stop = (action: 'send' | 'discard'): Promise<VoiceCaptureResult> => {
    if (current?.action) return Promise.resolve({ status: 'ignored' });
    if (!canStop()) {
      if (action === 'discard') reset();
      return Promise.resolve({ status: 'ignored' });
    }
    const generation = current!;
    generation.elapsedMs = Math.max(0, Math.round(elapsed(generation)));
    generation.startedAt = undefined;
    generation.action = action;
    clearTimers(generation);
    return new Promise((resolve) => {
      // A processing subscriber can release ownership synchronously.
      generation.resolve = resolve;
      publish({ elapsedMs: generation.elapsedMs, phase: 'processing' });
      if (!generation.acceptsEvents) return;
      try {
        generation.recorder!.stop();
      } catch (err) {
        generation.resolve = undefined;
        retire(generation);
        if (current === generation) {
          current = undefined;
          publish({ phase: 'idle', errorMessage: getVoiceRecorderErrorMessage(err) });
        }
        resolve({ status: 'failed' });
      }
    });
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start,
    canStop,
    pause: () => {
      const generation = current;
      if (!generation?.recorder || snapshot.phase !== 'recording' || !snapshot.canPause)
        return false;
      try {
        generation.recorder.pause();
      } catch {
        publish({ canPause: false });
        return false;
      }
      generation.elapsedMs = elapsed(generation);
      generation.startedAt = undefined;
      clearTimers(generation);
      publish({ phase: 'paused', elapsedMs: Math.max(0, Math.round(generation.elapsedMs)) });
      return true;
    },
    resume: () => {
      const generation = current;
      if (!generation?.recorder || snapshot.phase !== 'paused' || !snapshot.canPause) return false;
      try {
        generation.recorder.resume();
      } catch {
        publish({ canPause: false });
        return false;
      }
      generation.startedAt = now();
      startTimers(generation);
      if (!isRecording(generation)) return false;
      publish({ phase: 'recording' });
      return isRecording(generation);
    },
    finish: () => stop('send'),
    discard: async () => {
      await stop('discard');
      return false;
    },
    reset,
    clearError: () => {
      if (snapshot.errorMessage !== undefined) publish({ errorMessage: undefined });
    },
    releaseOwner: () => {
      if (released) return;
      released = true;
      const generation = current;
      current = undefined;
      if (generation?.action === 'send' && generation.resolve) releaseResources(generation);
      else if (generation) retire(generation);
      snapshot = idleSnapshot();
      releaseVoiceCaptureState(source);
    },
  };
};
