import { Trans, useTranslation } from 'react-i18next';
import React, { useMemo } from 'react';
import { Box, Text, color } from 'folds';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { SSOAction } from 'matrix-js-sdk';
import { useAuthServer } from '../../../hooks/useAuthServer';
import { RegisterFlowStatus, useAuthFlows } from '../../../hooks/useAuthFlows';
import { useParsedLoginFlows } from '../../../hooks/useParsedLoginFlows';
import { PasswordRegisterForm, SUPPORTED_REGISTER_STAGES } from '../register/PasswordRegisterForm';
import { OrDivider } from '../OrDivider';
import { SSOLogin } from '../SSOLogin';
import { SupportedUIAFlowsLoader } from '../../../components/SupportedUIAFlowsLoader';
import { getLoginPath } from '../../pathUtils';
import { usePathWithOrigin } from '../../../hooks/usePathWithOrigin';
import { RegisterPathSearchParams } from '../../paths';
import { useClientConfig } from '../../../hooks/useClientConfig';
import { hasAppleIdentityProvider } from '../ssoProviders';
import { isAddAccountSearch, withAddAccountSearch } from '../addAccount';
import {
  getMindroomAuthSsoRedirectUrl,
  shouldRequireAppleProvider,
  shouldUseSsoOnlyRegistration,
} from '../../../mindroom/auth/authUi';

const useRegisterSearchParams = (searchParams: URLSearchParams): RegisterPathSearchParams =>
  useMemo(
    () => ({
      username: searchParams.get('username') ?? undefined,
      email: searchParams.get('email') ?? undefined,
      token: searchParams.get('token') ?? undefined,
    }),
    [searchParams]
  );

export function Register() {
  const { t } = useTranslation();
  const server = useAuthServer();
  const { auth } = useClientConfig();
  const { loginFlows, registerFlows } = useAuthFlows();
  const [searchParams] = useSearchParams();
  const registerSearchParams = useRegisterSearchParams(searchParams);
  const addAccount = isAddAccountSearch(searchParams);
  const { sso } = useParsedLoginFlows(loginFlows.flows);
  const registrationAllowed = auth?.allowRegistration !== false;
  const requireAppleProvider = shouldRequireAppleProvider(server, auth);
  const appleProviderAvailable = hasAppleIdentityProvider(sso?.identity_providers);
  const ssoOnlyRegistration = shouldUseSsoOnlyRegistration(server);
  const showPasswordRegistration =
    registerFlows.status === RegisterFlowStatus.FlowRequired && !ssoOnlyRegistration;

  // redirect to /login because only that path handle m.login.token
  const webSsoRedirectUrl = usePathWithOrigin(getLoginPath(server));
  const ssoRedirectUrl = useMemo(() => {
    const redirectPath = addAccount ? withAddAccountSearch(webSsoRedirectUrl) : webSsoRedirectUrl;
    return getMindroomAuthSsoRedirectUrl(redirectPath);
  }, [addAccount, webSsoRedirectUrl]);

  if (!registrationAllowed) {
    return (
      <Navigate
        to={addAccount ? withAddAccountSearch(getLoginPath(server)) : getLoginPath(server)}
        replace
      />
    );
  }

  return (
    <Box direction="Column" gap="500">
      <Text size="H2" priority="400">
        {t('sharedUi.register.register')}
      </Text>
      {requireAppleProvider && !appleProviderAvailable && (
        <Text style={{ color: color.Critical.Main }} size="T300">
          {t(
            'sharedUi.register.thisClientRequiresSignInWithAppleConfigureTheHomeserverSsoProvider'
          )}
        </Text>
      )}
      {ssoOnlyRegistration && (
        <Text style={{ color: color.Warning.Main }} size="T300">
          {t('sharedUi.register.thisHomeserverOnlyAllowsSignUpWithAppleGoogleOrGithub')}
        </Text>
      )}
      {registerFlows.status === RegisterFlowStatus.RegistrationDisabled && !sso && (
        <Text style={{ color: color.Critical.Main }} size="T300">
          {t('sharedUi.register.registrationHasBeenDisabledOnThisHomeserver')}
        </Text>
      )}
      {registerFlows.status === RegisterFlowStatus.RateLimited && !sso && (
        <Text style={{ color: color.Critical.Main }} size="T300">
          {t('sharedUi.register.youHaveBeenRateLimitedPleaseTryAfterSomeTime')}
        </Text>
      )}
      {registerFlows.status === RegisterFlowStatus.InvalidRequest && !sso && (
        <Text style={{ color: color.Critical.Main }} size="T300">
          {t('sharedUi.register.invalidRequestFailedToGetAnyRegistrationOptions')}
        </Text>
      )}
      {showPasswordRegistration && (
        <>
          <SupportedUIAFlowsLoader
            flows={registerFlows.data.flows ?? []}
            supportedStages={SUPPORTED_REGISTER_STAGES}
          >
            {(supportedFlows) =>
              supportedFlows.length === 0 ? (
                <Text style={{ color: color.Critical.Main }} size="T300">
                  {t('sharedUi.register.thisApplicationDoesNotSupportRegistrationOnThisHomeserver')}
                </Text>
              ) : (
                <PasswordRegisterForm
                  authData={registerFlows.data}
                  uiaFlows={supportedFlows}
                  defaultUsername={registerSearchParams.username}
                  defaultEmail={registerSearchParams.email}
                  defaultRegisterToken={registerSearchParams.token}
                  addAccount={addAccount}
                />
              )
            }
          </SupportedUIAFlowsLoader>
          <span data-spacing-node />
          {sso && <OrDivider />}
        </>
      )}
      {ssoOnlyRegistration && !sso && (
        <Text style={{ color: color.Critical.Main }} size="T300">
          {t('sharedUi.register.ssoRegistrationIsRequiredOnThisHomeserverButNoSsoProvidersWere')}
        </Text>
      )}
      {sso && (
        <>
          <SSOLogin
            providers={sso.identity_providers}
            redirectUrl={ssoRedirectUrl}
            action={SSOAction.REGISTER}
            saveScreenSpace={showPasswordRegistration}
          />
          <span data-spacing-node />
        </>
      )}
      <Text align="Center">
        <Trans
          t={t}
          shouldUnescape
          tOptions={{ interpolation: { escapeValue: true } }}
          i18nKey="sharedUi.register.accountLink"
          components={{
            authLink: (
              <Link
                to={addAccount ? withAddAccountSearch(getLoginPath(server)) : getLoginPath(server)}
              />
            ),
          }}
        />
      </Text>
    </Box>
  );
}
