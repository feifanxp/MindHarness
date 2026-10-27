import { Trans, useTranslation } from 'react-i18next';
import { Box, Text } from 'folds';
import React, { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getLoginPath } from '../../pathUtils';
import { useAuthServer } from '../../../hooks/useAuthServer';
import { PasswordResetForm } from './PasswordResetForm';
import { ResetPasswordPathSearchParams } from '../../paths';
import { isAddAccountSearch, withAddAccountSearchIf } from '../addAccount';

const useResetPasswordSearchParams = (
  searchParams: URLSearchParams
): ResetPasswordPathSearchParams =>
  useMemo(
    () => ({
      email: searchParams.get('email') ?? undefined,
    }),
    [searchParams]
  );

export function ResetPassword() {
  const { t } = useTranslation();
  const server = useAuthServer();
  const [searchParams] = useSearchParams();
  const resetPasswordSearchParams = useResetPasswordSearchParams(searchParams);
  const addAccount = isAddAccountSearch(searchParams);

  return (
    <Box direction="Column" gap="500">
      <Text size="H2" priority="400">
        {t('sharedUi.resetPassword.resetPassword')}
      </Text>
      <PasswordResetForm defaultEmail={resetPasswordSearchParams.email} addAccount={addAccount} />
      <span data-spacing-node />

      <Text align="Center">
        <Trans
          t={t}
          shouldUnescape
          tOptions={{ interpolation: { escapeValue: true } }}
          i18nKey="sharedUi.resetPassword.accountLink"
          components={{
            authLink: <Link to={withAddAccountSearchIf(getLoginPath(server), addAccount)} />,
          }}
        />
      </Text>
    </Box>
  );
}
