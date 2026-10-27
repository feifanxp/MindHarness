import { CryptoApi } from 'matrix-js-sdk/lib/crypto-api';

export const verifiedDevice = async (
  api: CryptoApi,
  userId: string,
  deviceId: string
): Promise<boolean | null> => {
  const status = await api.getDeviceVerificationStatus(userId, deviceId);

  if (!status) return null;

  const verified = status.crossSigningVerified;
  return verified;
};

/**
 * Whether a device is signed by its owner's own self-signing key.
 *
 * Unlike {@link verifiedDevice}, this does not require the local user to have
 * verified the device's owner: it is true as soon as the owner bootstrapped
 * cross-signing and signed the device. This is the signal that keeps a device
 * eligible for room keys under MSC4153 ("exclude non-cross-signed devices").
 * Returns `null` when crypto cannot report a status for the device.
 */
export const deviceSignedByOwner = async (
  api: CryptoApi,
  userId: string,
  deviceId: string
): Promise<boolean | null> => {
  const status = await api.getDeviceVerificationStatus(userId, deviceId);

  if (!status) return null;

  return status.signedByOwner;
};
