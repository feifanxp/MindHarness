import { MatrixClient } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { getPowerTagIconSrc } from './useMemberPowerTag';

// The real theme module imports generated styles that Vitest does not load.
vi.mock('./useTheme', () => ({ ThemeKind: { Dark: 'dark', Light: 'light' } }));

describe('getPowerTagIconSrc', () => {
  it('keeps emoji icons and drops non-mxc URLs', () => {
    const mx = {} as MatrixClient;

    expect(getPowerTagIconSrc(mx, true, { key: '🛡️' })).toBe('🛡️');
    expect(getPowerTagIconSrc(mx, true, { key: 'https://example.org/icon.png' })).toBeUndefined();
  });
});
