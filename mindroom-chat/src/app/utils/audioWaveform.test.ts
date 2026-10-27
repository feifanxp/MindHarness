import { describe, expect, it } from 'vitest';
import {
  VOICE_WAVEFORM_BAR_COUNT,
  VOICE_WAVEFORM_MAX,
  analyserRmsToMatrixPoint,
  clampWaveformPoint,
  createFallbackWaveform,
  normalizeMatrixWaveform,
  normalizeOptionalMatrixWaveform,
  resampleWaveform,
  timeDomainDataToWaveformPoint,
} from './audioWaveform';

describe('audioWaveform utils', () => {
  it('clamps invalid, negative, non-finite, and out-of-range points', () => {
    expect(clampWaveformPoint(-20)).toBe(0);
    expect(clampWaveformPoint(40.6)).toBe(41);
    expect(clampWaveformPoint(9999)).toBe(VOICE_WAVEFORM_MAX);
    expect(clampWaveformPoint(Number.NaN)).toBe(0);
    expect(clampWaveformPoint('bad')).toBe(0);
  });

  it('normalizes short, long, and malformed Matrix metadata to 48 bars', () => {
    const short = normalizeMatrixWaveform([0, 512, 1024]);
    expect(short).toHaveLength(VOICE_WAVEFORM_BAR_COUNT);
    expect(short[0]).toBe(0);
    expect(short.at(-1)).toBe(1024);

    const long = normalizeMatrixWaveform(Array.from({ length: 96 }, (_value, index) => index));
    expect(long).toHaveLength(VOICE_WAVEFORM_BAR_COUNT);
    expect(long[0]).toBeGreaterThanOrEqual(0);
    expect(long.at(-1)).toBeLessThanOrEqual(96);

    const malformed = normalizeMatrixWaveform([Number.NaN, 'x', -10, 2048]);
    expect(malformed).toHaveLength(VOICE_WAVEFORM_BAR_COUNT);
    expect(Math.min(...malformed)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...malformed)).toBeLessThanOrEqual(VOICE_WAVEFORM_MAX);
  });

  it('returns undefined for missing optional metadata but normalizes provided arrays', () => {
    expect(normalizeOptionalMatrixWaveform(undefined)).toBeUndefined();
    expect(normalizeOptionalMatrixWaveform([])).toBeUndefined();
    expect(normalizeOptionalMatrixWaveform(['bad'])).toBeUndefined();
    expect(normalizeOptionalMatrixWaveform([1, 2, 3])).toHaveLength(VOICE_WAVEFORM_BAR_COUNT);
  });

  it('resamples live samples deterministically', () => {
    expect(resampleWaveform([0, 1000], 4)).toEqual([0, 0, 1000, 1000]);
    expect(resampleWaveform([0, 100, 200, 300], 2)).toEqual([50, 250]);
  });

  it('creates deterministic fallback waveform data', () => {
    const first = createFallbackWaveform();
    const second = createFallbackWaveform();

    expect(first).toEqual(second);
    expect(first).toHaveLength(VOICE_WAVEFORM_BAR_COUNT);
    expect(Math.min(...first)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...first)).toBeLessThanOrEqual(VOICE_WAVEFORM_MAX);
  });

  it('maps analyser RMS levels to Matrix waveform points', () => {
    expect(analyserRmsToMatrixPoint(0)).toBe(0);
    expect(analyserRmsToMatrixPoint(1)).toBe(VOICE_WAVEFORM_MAX);
    expect(analyserRmsToMatrixPoint(0.25)).toBe(512);
  });

  it('maps analyser time-domain data to a waveform point', () => {
    expect(timeDomainDataToWaveformPoint(new Uint8Array([128, 128, 128]))).toBe(0);
    expect(timeDomainDataToWaveformPoint(new Uint8Array([0, 255]))).toBeGreaterThan(900);
  });
});
