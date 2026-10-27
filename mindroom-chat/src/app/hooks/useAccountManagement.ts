import { useMemo } from 'react';
import { ValidatedAuthMetadata } from 'matrix-js-sdk';
import { withSearchParam } from '../pages/pathUtils';

export const useAccountManagementActions = () => {
  const actions = useMemo(
    () => ({
      profile: 'org.matrix.profile',
      sessionsList: 'org.matrix.devices_list',
      sessionView: 'org.matrix.device_view',
      sessionEnd: 'org.matrix.device_delete',
      accountDeactivate: 'org.matrix.account_deactivate',
      crossSigningReset: 'org.matrix.cross_signing_reset',
    }),
    []
  );

  return actions;
};

/**
 * Returns the server's account management URL with the given search params,
 * or undefined when the server has no http(s) account management URL.
 */
export const getAccountManagementUrl = (
  authMetadata: ValidatedAuthMetadata | undefined,
  searchParams: Record<string, string>
): string | undefined => {
  const authUrl = authMetadata?.account_management_uri ?? authMetadata?.issuer;
  if (!authUrl || !/^https?:\/\//i.test(authUrl)) return undefined;

  return withSearchParam(authUrl, searchParams);
};
