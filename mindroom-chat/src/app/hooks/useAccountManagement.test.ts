import { ValidatedAuthMetadata } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { getAccountManagementUrl } from './useAccountManagement';

// eslint-disable-next-line no-script-url -- a URL that must not be opened
const scriptUrl = 'javascript:alert(1)//';

const authMetadata = (fields: Partial<ValidatedAuthMetadata>) =>
  ({ issuer: 'https://auth.example.org/', ...fields } as ValidatedAuthMetadata);

describe('getAccountManagementUrl', () => {
  it('adds the search params to the account management URL', () => {
    expect(
      getAccountManagementUrl(
        authMetadata({ account_management_uri: 'https://auth.example.org/account' }),
        { action: 'org.matrix.device_delete', device_id: 'ABC' }
      )
    ).toBe('https://auth.example.org/account?action=org.matrix.device_delete&device_id=ABC');
    expect(getAccountManagementUrl(authMetadata({}), { action: 'org.matrix.devices_list' })).toBe(
      'https://auth.example.org/?action=org.matrix.devices_list'
    );
  });

  it('returns undefined for an account management URL that is not http(s)', () => {
    expect(
      getAccountManagementUrl(authMetadata({ account_management_uri: scriptUrl }), {
        action: 'org.matrix.devices_list',
      })
    ).toBeUndefined();
    expect(
      getAccountManagementUrl(authMetadata({ issuer: scriptUrl }), {
        action: 'org.matrix.devices_list',
      })
    ).toBeUndefined();
  });
});
