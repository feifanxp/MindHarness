import { useCallback, useEffect, useState } from 'react';
import { MatrixError, Method } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useAlive } from '../../hooks/useAlive';
import { useKeyBackupStatusChange } from '../../hooks/useKeyBackup';

/**
 * Three-state key-backup presence with a fail-hidden default.
 *
 * `crypto.getKeyBackupInfo()` conflates two very different outcomes: it returns
 * `null` both when the server confirms M_NOT_FOUND (there is genuinely no
 * backup) and when the underlying `/room_keys/version` request fails (network
 * error, 429, transient outage). Treating that conflated `null` as "no backup"
 * pushes the onboarding nudge in front of users who already have backup any
 * time the initial check happens to fail — and once dismissed the nudge is
 * permanently suppressed per account.
 *
 * We instead issue the request ourselves and distinguish M_NOT_FOUND (`absent`)
 * from every other failure mode (`unknown`, which stays hidden until the next
 * successful check). Only `absent` should surface the nudge.
 */
export type KeyBackupPresence = 'unknown' | 'absent' | 'present';

const KEY_BACKUP_VERSION_PATH = '/room_keys/version';
const KEY_BACKUP_PREFIX = '/_matrix/client/v3';

const isNotFoundError = (error: unknown): boolean =>
  error instanceof MatrixError && (error.errcode === 'M_NOT_FOUND' || error.httpStatus === 404);

export const useKeyBackupPresence = (): KeyBackupPresence => {
  const mx = useMatrixClient();
  const alive = useAlive();
  const [presence, setPresence] = useState<KeyBackupPresence>('unknown');

  const check = useCallback(async () => {
    try {
      await mx.http.authedRequest(Method.Get, KEY_BACKUP_VERSION_PATH, undefined, undefined, {
        prefix: KEY_BACKUP_PREFIX,
      });
      if (alive()) setPresence('present');
    } catch (error) {
      if (!alive()) return;
      // Only a definitive M_NOT_FOUND surfaces the nudge; every other failure
      // (network, rate limit, auth glitch) stays hidden rather than nagging a
      // user who may already have backup enabled.
      setPresence(isNotFoundError(error) ? 'absent' : 'unknown');
    }
  }, [mx, alive]);

  useEffect(() => {
    check();
  }, [check]);

  // Re-check on any key-backup status transition so enabling backup elsewhere
  // (e.g. Settings → Devices → Backup Restore) flips the nudge off.
  useKeyBackupStatusChange(
    useCallback(() => {
      check();
    }, [check])
  );

  return presence;
};
