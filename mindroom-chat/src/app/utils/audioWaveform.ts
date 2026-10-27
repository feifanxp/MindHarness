export const VOICE_WAVEFORM_BAR_COUNT = 48;
export const VOICE_WAVEFORM_MAX = 1024;
export const VOICE_WAVEFORM_MIN = 0;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const clampWaveformPoint = (value: unknown): number =>
  clamp(Math.round(isFiniteNumber(value) ? value : 0), VOICE_WAVEFORM_MIN, VOICE_WAVEFORM_MAX);

const sanitizeWaveformPoints = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];

  return value.filter(isFiniteNumber).map(clampWaveformPoint);
};

export const createFallbackWaveform = (barCount = VOICE_WAVEFORM_BAR_COUNT): number[] => {
  if (barCount <= 0) return [];

  return Array.from({ length: barCount }, (_value, index) => {
    const phase = index / Math.max(1, barCount - 1);
    const primary = Math.sin(phase * Math.PI);
    const secondary = Math.sin(phase * Math.PI * 5) * 0.18;
    return clampWaveformPoint(220 + (primary + secondary) * 500);
  });
};

export const resampleWaveform = (value: unknown, barCount = VOICE_WAVEFORM_BAR_COUNT): number[] => {
  if (barCount <= 0) return [];

  const points = sanitizeWaveformPoints(value);
  if (points.length === 0) return createFallbackWaveform(barCount);
  if (points.length === barCount) return points;
  if (points.length === 1) return Array.from({ length: barCount }, () => points[0]);

  return Array.from({ length: barCount }, (_value, index) => {
    const start = (index * points.length) / barCount;
    const end = ((index + 1) * points.length) / barCount;
    const first = Math.floor(start);
    const last = Math.ceil(end);
    let total = 0;
    let weight = 0;

    for (let pointIndex = first; pointIndex < last; pointIndex += 1) {
      const overlapStart = Math.max(start, pointIndex);
      const overlapEnd = Math.min(end, pointIndex + 1);
      const overlap = overlapEnd - overlapStart;
      if (overlap <= 0 || pointIndex < 0 || pointIndex >= points.length) continue;

      total += points[pointIndex] * overlap;
      weight += overlap;
    }

    if (weight === 0) {
      return points[clamp(Math.floor(start), 0, points.length - 1)];
    }

    return clampWaveformPoint(total / weight);
  });
};

export const normalizeMatrixWaveform = (
  value: unknown,
  barCount = VOICE_WAVEFORM_BAR_COUNT
): number[] => resampleWaveform(value, barCount);

export const normalizeOptionalMatrixWaveform = (
  value: unknown,
  barCount = VOICE_WAVEFORM_BAR_COUNT
): number[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  if (!value.some(isFiniteNumber)) return undefined;
  return normalizeMatrixWaveform(value, barCount);
};

export const analyserRmsToMatrixPoint = (rms: number): number => {
  const normalized = clamp(Number.isFinite(rms) ? rms : 0, 0, 1);
  return clampWaveformPoint(Math.sqrt(normalized) * VOICE_WAVEFORM_MAX);
};

export const timeDomainDataToWaveformPoint = (data: Uint8Array): number => {
  if (data.length === 0) return 0;

  let squareSum = 0;
  for (let index = 0; index < data.length; index += 1) {
    const centered = (data[index] - 128) / 128;
    squareSum += centered * centered;
  }

  return analyserRmsToMatrixPoint(Math.sqrt(squareSum / data.length));
};
