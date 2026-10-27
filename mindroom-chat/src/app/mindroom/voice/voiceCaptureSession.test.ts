import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVoiceCaptureSession, type VoiceCaptureSession } from './voiceCaptureSession';

const diagnostics = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock('../diagnostics/flightRecorder', () => ({
  setFlightRecorderVoiceCaptureState: diagnostics.publish,
}));
vi.mock('../native/nativeSso', () => ({ isNativeApp: () => false }));

class Recorder {
  static instances: Recorder[] = [];

  static isTypeSupported = () => true;

  state: RecordingState = 'inactive';

  mimeType: string;

  listeners = new Map<string, Set<(event: any) => void>>();

  constructor(_stream: MediaStream, readonly options: MediaRecorderOptions) {
    this.mimeType = options.mimeType ?? '';
    Recorder.instances.push(this);
  }

  addEventListener(type: string, listener: (event: any) => void) {
    const entries = this.listeners.get(type) ?? new Set();
    entries.add(listener);
    this.listeners.set(type, entries);
  }

  removeEventListener(type: string, listener: (event: any) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  start() {
    this.state = 'recording';
  }

  pause() {
    this.state = 'paused';
  }

  resume() {
    this.state = 'recording';
  }

  stop = vi.fn(() => {
    this.state = 'inactive';
  });

  emitData(data: Blob) {
    this.listeners.get('dataavailable')?.forEach((listener) => listener({ data }));
  }

  emitStop() {
    this.state = 'inactive';
    this.listeners.get('stop')?.forEach((listener) => listener(new Event('stop')));
  }
}
class Audio {
  static instances: Audio[] = [];

  static failure: 'source' | 'analyser' | 'connect' | undefined;

  state = 'running';

  source = {
    disconnect: vi.fn(),
    connect: vi.fn(() => {
      if (Audio.failure === 'connect') throw new Error('connect');
    }),
  };

  analyser = { fftSize: 2048, getByteTimeDomainData: (buffer: Uint8Array) => buffer.fill(160) };

  close = vi.fn(async () => undefined);

  constructor() {
    Audio.instances.push(this);
  }

  createMediaStreamSource() {
    if (Audio.failure === 'source') throw new Error('source');
    return this.source;
  }

  createAnalyser() {
    if (Audio.failure === 'analyser') throw new Error('analyser');
    return this.analyser;
  }
}
const newStream = () => {
  const track = { stop: vi.fn() };
  return { track, getTracks: () => [track] };
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
let stream: ReturnType<typeof newStream>;
let getUserMedia: ReturnType<typeof vi.fn>;
let sessions: VoiceCaptureSession[];
const capture = () => {
  const session = createVoiceCaptureSession();
  sessions.push(session);
  return session;
};
const latest = () => Recorder.instances.at(-1)!;
const finish = async (session: VoiceCaptureSession, body = 'voice') => {
  const recorder = latest();
  const result = session.finish();
  recorder.emitData(new Blob([body], { type: 'audio/webm' }));
  recorder.emitStop();
  return result;
};

beforeEach(() => {
  vi.useFakeTimers();
  sessions = [];
  stream = newStream();
  getUserMedia = vi.fn(async () => stream);
  Recorder.instances = [];
  Audio.instances = [];
  Audio.failure = undefined;
  diagnostics.publish.mockClear();
  vi.stubGlobal('window', { isSecureContext: true, AudioContext: Audio });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('MediaRecorder', Recorder);
});
afterEach(() => {
  sessions.forEach((session) => session.releaseOwner());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('voice capture session', () => {
  it('constructs without browser effects and publishes stable immutable snapshots', async () => {
    const session = capture();
    const idle = session.getSnapshot();
    expect(session.getSnapshot()).toBe(idle);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(diagnostics.publish).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    await session.start();
    const recording = session.getSnapshot();
    expect(recording).not.toBe(idle);
    expect(session.getSnapshot()).toBe(recording);
    expect(() => recording.waveform.push(999)).toThrow();
    const retained = [...recording.waveform];
    vi.advanceTimersByTime(80);
    expect(recording.waveform).toEqual(retained);
    expect(session.getSnapshot().waveform).toHaveLength(2);
    unsubscribe();
    listener.mockClear();
    vi.advanceTimersByTime(80);
    expect(listener).not.toHaveBeenCalled();
    const result = await finish(session);
    expect(result.status).toBe('captured');
    if (result.status === 'captured') expect(result.recording.waveform).not.toContain(999);
  });

  it('captures compressed audio and counts only active time across pause', async () => {
    const session = capture();
    await session.start();
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        channelCount: 1,
        sampleRate: 24_000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    expect(latest().options.audioBitsPerSecond).toBe(32_000);
    vi.advanceTimersByTime(250);
    expect(session.pause()).toBe(true);
    const paused = session.getSnapshot();
    vi.advanceTimersByTime(5000);
    expect(session.getSnapshot()).toBe(paused);
    expect(session.resume()).toBe(true);
    vi.advanceTimersByTime(150);
    const result = await finish(session);
    expect(result.status).toBe('captured');
    if (result.status !== 'captured') throw new Error('missing recording');
    expect(result.recording.duration).toBe(400);
    expect(await result.recording.file.text()).toBe('voice');
    expect(result.recording.file.type).toBe(latest().mimeType);
    expect(result.recording.waveform).toEqual(Array(48).fill(512));
    expect(session.getSnapshot().phase).toBe('processing');
    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(Audio.instances[0].source.disconnect).toHaveBeenCalledOnce();
    expect(Audio.instances[0].close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains accepted finish after release while suppressing observers and diagnostics', async () => {
    const session = capture();
    const send = vi.fn();
    await session.start();
    vi.advanceTimersByTime(250);
    const recorder = latest();
    const result = session.finish();
    expect(session.canStop()).toBe(false);
    expect(await session.discard()).toBe(false);
    session.releaseOwner();
    const listener = vi.fn();
    session.subscribe(listener);
    const publicationCount = diagnostics.publish.mock.calls.length;
    recorder.emitData(new Blob(['voice'], { type: 'audio/webm' }));
    recorder.emitStop();
    const finished = await result;
    expect(finished.status).toBe('captured');
    if (finished.status === 'captured') {
      expect(await finished.recording.file.text()).toBe('voice');
      expect(finished.recording.duration).toBe(250);
    }
    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
    expect(diagnostics.publish).toHaveBeenCalledTimes(publicationCount);
    expect(send).not.toHaveBeenCalled();
  });

  it('retains finish when a processing subscriber synchronously releases ownership', async () => {
    const session = capture();
    await session.start();
    const recorder = latest();
    session.subscribe(() => {
      if (session.getSnapshot().phase === 'processing') session.releaseOwner();
    });
    const result = session.finish();
    recorder.emitData(new Blob(['accepted']));
    recorder.emitStop();
    const completed = await result;
    expect(completed.status).toBe('captured');
    if (completed.status === 'captured')
      expect(await completed.recording.file.text()).toBe('accepted');
    expect(stream.track.stop).toHaveBeenCalledOnce();
  });

  it.each(['permission', 'sample'] as const)(
    'releases resources when a %s subscriber tears down during start',
    async (releaseAt) => {
      const session = capture();
      session.subscribe(() => {
        const snapshot = session.getSnapshot();
        if (
          releaseAt === 'permission'
            ? Recorder.instances.length > 0
            : snapshot.waveform.length === 1
        )
          session.releaseOwner();
      });
      expect(await session.start()).toBe(false);
      expect(stream.track.stop).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      expect(session.getSnapshot().phase).toBe('idle');
      expect(latest().state).toBe('inactive');
    }
  );

  it.each([
    ['initial', 'releaseOwner'],
    ['initial', 'reset'],
    ['requesting', 'releaseOwner'],
    ['requesting', 'reset'],
  ] as const)(
    'cancels start on %s notification %s before permission acquisition',
    async (notification, operation) => {
      const session = capture();
      let canceled = false;
      session.subscribe(() => {
        if (
          !canceled &&
          (notification === 'initial' || session.getSnapshot().phase === 'requesting')
        ) {
          canceled = true;
          session[operation]();
        }
      });
      const started = await session.start();
      expect(getUserMedia).not.toHaveBeenCalled();
      expect(Recorder.instances).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(session.getSnapshot().phase).toBe('idle');
      expect(started).toBe(false);
      session.releaseOwner();
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('does not resurrect recording when an immediate resume sample resets capture', async () => {
    const session = capture();
    await session.start();
    vi.advanceTimersByTime(250);
    session.pause();
    const samples = session.getSnapshot().waveform.length;
    let reset = false;
    const unsubscribe = session.subscribe(() => {
      if (!reset && session.getSnapshot().waveform.length > samples) {
        reset = true;
        session.reset();
      }
    });
    const resumed = session.resume();
    expect(session.getSnapshot().phase).toBe('idle');
    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(resumed).toBe(false);
    unsubscribe();
    expect(await session.start()).toBe(true);
  });

  it.each(['start', 'resume'] as const)(
    'preserves accepted finish from the immediate %s sample',
    async (operation) => {
      const session = capture();
      if (operation === 'resume') {
        await session.start();
        vi.advanceTimersByTime(250);
        session.pause();
        vi.advanceTimersByTime(500);
      }
      const sampleCount = operation === 'start' ? 0 : session.getSnapshot().waveform.length;
      const NativeFile = File;
      const files: File[] = [];
      vi.stubGlobal(
        'File',
        class extends NativeFile {
          constructor(bits: BlobPart[], name: string, options?: FilePropertyBag) {
            super(bits, name, options);
            files.push(this);
          }
        }
      );
      let accepted: ReturnType<VoiceCaptureSession['finish']> | undefined;
      let claimed = false;
      session.subscribe(() => {
        if (
          !claimed &&
          session.canStop() &&
          session.getSnapshot().waveform.length === sampleCount + 1
        ) {
          claimed = true;
          accepted = session.finish();
        }
      });
      const started = await session[operation]();
      expect(accepted).toBeDefined();
      expect(session.getSnapshot().phase).toBe('processing');
      expect(started).toBe(false);
      const recorder = latest();
      expect(recorder.stop).toHaveBeenCalledOnce();
      recorder.emitData(new Blob(['accepted-' + operation], { type: 'audio/webm' }));
      recorder.emitStop();
      const result = await accepted!;
      expect(result.status).toBe('captured');
      if (result.status !== 'captured') throw new Error('missing accepted recording');
      expect(await result.recording.file.text()).toBe('accepted-' + operation);
      expect(result.recording.duration).toBe(operation === 'start' ? 1 : 250);
      recorder.emitData(new Blob(['late']));
      recorder.emitStop();
      expect(files).toEqual([result.recording.file]);
      expect(await session.finish()).toEqual({ status: 'ignored' });
      expect(stream.track.stop).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      expect(session.getSnapshot().phase).toBe('processing');
    }
  );

  it.each([
    ['start', 'releaseOwner'],
    ['start', 'reset'],
    ['resume', 'releaseOwner'],
    ['resume', 'reset'],
  ] as const)(
    'reports false when final %s recording notification invokes %s',
    async (operation, teardown) => {
      const session = capture();
      if (operation === 'resume') {
        await session.start();
        session.pause();
      }
      session.subscribe(() => {
        if (session.getSnapshot().phase === 'recording') session[teardown]();
      });
      const started = await session[operation]();
      expect(session.getSnapshot().phase).toBe('idle');
      expect(stream.track.stop).toHaveBeenCalledOnce();
      expect(Audio.instances[0].close).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      expect(started).toBe(false);
    }
  );

  it.each(['resolve', 'reject', 'overconstrained'] as const)(
    'ignores permission %s after release',
    async (outcome) => {
      const permission = deferred<ReturnType<typeof newStream>>();
      getUserMedia.mockReturnValue(permission.promise);
      const session = capture();
      const started = session.start();
      session.releaseOwner();
      if (outcome === 'resolve') permission.resolve(stream);
      else
        permission.reject(
          new DOMException(
            'denied',
            outcome === 'overconstrained' ? 'OverconstrainedError' : 'NotAllowedError'
          )
        );
      expect(await started).toBe(false);
      expect(getUserMedia).toHaveBeenCalledOnce();
      expect(Recorder.instances).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(session.getSnapshot().errorMessage).toBeUndefined();
      if (outcome === 'resolve') expect(stream.track.stop).toHaveBeenCalledOnce();
    }
  );

  it.each(['OverconstrainedError', 'NotAllowedError'])(
    'retries only overconstrained permission: %s',
    async (name) => {
      getUserMedia.mockRejectedValueOnce(new DOMException('denied', name));
      const session = capture();
      expect(await session.start()).toBe(name === 'OverconstrainedError');
      expect(getUserMedia).toHaveBeenCalledTimes(name === 'OverconstrainedError' ? 2 : 1);
      if (name === 'OverconstrainedError')
        expect(getUserMedia).toHaveBeenLastCalledWith({ audio: true });
    }
  );

  it.each(['source', 'analyser', 'connect'] as const)(
    'releases partial audio setup at %s and still captures duration-only audio',
    async (failure) => {
      Audio.failure = failure;
      const session = capture();
      await session.start();
      expect(Audio.instances[0].close).toHaveBeenCalledOnce();
      if (failure !== 'source') expect(Audio.instances[0].source.disconnect).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(250);
      const result = await finish(session);
      expect(result.status).toBe('captured');
      if (result.status === 'captured') {
        expect(result.recording.duration).toBe(250);
        expect(result.recording.waveform).toBeUndefined();
      }
    }
  );

  it('releases resources and reports failed when native stop throws', async () => {
    const session = capture();
    await session.start();
    latest().stop.mockImplementation(() => {
      throw new Error('stop failed');
    });
    expect(await session.finish()).toEqual({ status: 'failed' });
    expect(session.getSnapshot().errorMessage).toBe('stop failed');
    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(Audio.instances[0].close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    session.clearError();
    expect(session.getSnapshot().errorMessage).toBeUndefined();
  });

  it('rejects empty audio and unsolicited stops without producing captured data', async () => {
    const session = capture();
    await session.start();
    const result = session.finish();
    latest().emitData(new Blob([]));
    latest().emitStop();
    expect(await result).toEqual({ status: 'failed' });
    expect(session.getSnapshot().errorMessage).toBe('No audio data was captured.');
    await session.start();
    latest().emitData(new Blob(['unclaimed']));
    latest().emitStop();
    expect(session.getSnapshot().errorMessage).toBe(
      'Voice recording stopped unexpectedly. Please record again.'
    );
    expect(await session.finish()).toEqual({ status: 'ignored' });
  });

  it('discards with false and releases ordinary ownership before native stop arrives', async () => {
    const session = capture();
    await session.start();
    const result = session.discard();
    latest().emitData(new Blob(['discarded']));
    latest().emitStop();
    expect(await result).toBe(false);
    expect(session.getSnapshot().phase).toBe('idle');
    await session.start();
    session.releaseOwner();
    expect(latest().stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(session.getSnapshot().phase).toBe('idle');
  });

  it.each([false, true])(
    'isolates old data/stop from new capture after release; accepted=%s',
    async (accepted) => {
      const session = capture();
      await session.start();
      vi.advanceTimersByTime(250);
      const old = latest();
      const oldResult = accepted ? session.finish() : undefined;
      session.releaseOwner();
      session.releaseOwner();
      const freshStream = newStream();
      getUserMedia.mockResolvedValue(freshStream);
      await session.start();
      Audio.instances.at(-1)!.analyser.getByteTimeDomainData = (buffer) => buffer.fill(144);
      vi.advanceTimersByTime(80);
      const snapshot = session.getSnapshot();
      old.emitData(new Blob(['old']));
      old.emitStop();
      expect(session.getSnapshot()).toBe(snapshot);
      expect(freshStream.track.stop).not.toHaveBeenCalled();
      vi.advanceTimersByTime(160);
      const result = await finish(session, 'fresh');
      if (result.status !== 'captured') throw new Error('missing fresh recording');
      expect(await result.recording.file.text()).toBe('fresh');
      expect(result.recording.duration).toBe(240);
      expect(result.recording.waveform!.at(-1)).toBe(362);
      expect(snapshot.waveform).toEqual([512, 362]);
      if (oldResult) {
        const completed = await oldResult;
        if (completed.status !== 'captured') throw new Error('missing accepted recording');
        expect(await completed.recording.file.text()).toBe('old');
        expect(completed.recording.duration).toBe(250);
      }
    }
  );

  it('bounds raw live samples without normalizing display data', async () => {
    const session = capture();
    await session.start();
    Audio.instances[0].analyser.getByteTimeDomainData = (buffer) => buffer.fill(128);
    vi.advanceTimersByTime(96_000);
    expect(session.getSnapshot().waveform).toEqual(Array(1200).fill(0));
    const result = await finish(session);
    if (result.status !== 'captured') throw new Error('missing recording');
    expect(result.recording.waveform).toHaveLength(48);
  });
});
