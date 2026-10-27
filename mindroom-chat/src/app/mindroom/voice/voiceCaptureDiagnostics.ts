import {
  setFlightRecorderVoiceCaptureState,
  type VoiceCaptureState,
} from '../diagnostics/flightRecorder';

const states = new Map<symbol, VoiceCaptureState>();

export const publishVoiceCaptureState = (source: symbol, state: VoiceCaptureState): void => {
  states.delete(source);
  if (state !== 'inactive') states.set(source, state);
  setFlightRecorderVoiceCaptureState(Array.from(states.values()).at(-1) ?? 'inactive');
};

export const releaseVoiceCaptureState = (source: symbol): void => {
  if (states.has(source)) publishVoiceCaptureState(source, 'inactive');
};
