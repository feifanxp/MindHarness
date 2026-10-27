import { expect, it, vi } from 'vitest';
import { publishVoiceCaptureState, releaseVoiceCaptureState } from './voiceCaptureDiagnostics';

const diagnostics = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock('../diagnostics/flightRecorder', () => ({
  setFlightRecorderVoiceCaptureState: diagnostics.publish,
}));

it('retains last-active source when an idle third owner or active owner releases', () => {
  const first = Symbol('first');
  const second = Symbol('second');
  const idle = Symbol('idle');
  publishVoiceCaptureState(first, 'recording');
  publishVoiceCaptureState(second, 'paused');
  releaseVoiceCaptureState(idle);
  expect(diagnostics.publish).toHaveBeenLastCalledWith('paused');
  releaseVoiceCaptureState(second);
  expect(diagnostics.publish).toHaveBeenLastCalledWith('recording');
  publishVoiceCaptureState(first, 'processing');
  expect(diagnostics.publish).toHaveBeenLastCalledWith('processing');
  releaseVoiceCaptureState(first);
  expect(diagnostics.publish).toHaveBeenLastCalledWith('inactive');
});
