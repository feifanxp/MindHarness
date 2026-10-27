import { describe, expect, it } from 'vitest';
import { CryptoApi } from 'matrix-js-sdk/lib/crypto-api';
import { deviceSignedByOwner } from './matrix-crypto';

const cryptoReporting = (status: Record<string, unknown> | null): CryptoApi =>
  ({
    getDeviceVerificationStatus: async () => status,
  } as unknown as CryptoApi);

describe('deviceSignedByOwner', () => {
  it('reports the signedByOwner flag, independent of crossSigningVerified', async () => {
    // The whole affordance hinges on this field selection: a bot device is
    // signed by its own self-signing key (signedByOwner) but is NOT verified by
    // the local user (crossSigningVerified stays false), which is by design.
    const api = cryptoReporting({ signedByOwner: true, crossSigningVerified: false });

    expect(await deviceSignedByOwner(api, '@mindroom_code:example.org', 'DEV1')).toBe(true);
  });

  it('is false when the device is not signed by its owner', async () => {
    const api = cryptoReporting({ signedByOwner: false, crossSigningVerified: true });

    expect(await deviceSignedByOwner(api, '@mindroom_code:example.org', 'DEV1')).toBe(false);
  });

  it('returns null when crypto cannot report a status for the device', async () => {
    const api = cryptoReporting(null);

    expect(await deviceSignedByOwner(api, '@mindroom_code:example.org', 'DEV1')).toBeNull();
  });
});
