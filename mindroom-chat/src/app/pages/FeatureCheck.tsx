import { useTranslation } from 'react-i18next';
import React, { ReactNode, useEffect } from 'react';
import { Box, Text, config } from 'folds';
import { Dialog } from '../components/glass/GlassPrimitives';
import { AsyncStatus, useAsyncCallback } from '../hooks/useAsyncCallback';
import { checkIndexedDBSupport } from '../utils/featureCheck';
import { SplashScreen } from '../components/splash-screen';

export function FeatureCheck({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [idbSupportState, checkIDBSupport] = useAsyncCallback(checkIndexedDBSupport);

  useEffect(() => {
    checkIDBSupport();
  }, [checkIDBSupport]);

  if (idbSupportState.status === AsyncStatus.Success && idbSupportState.data === false) {
    return (
      <SplashScreen>
        <Box grow="Yes" alignItems="Center" justifyContent="Center">
          <Dialog>
            <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
              <Text>{t('sharedUi.featureCheck.missingBrowserFeature')}</Text>
              <Text size="T300" priority="400">
                {t(
                  'sharedUi.featureCheck.noIndexeddbSupportFoundThisApplicationRequiresIndexeddbToStoreSessionData'
                )}
              </Text>
              <Text size="T200">
                <a
                  href="https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API"
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  {t('sharedUi.featureCheck.whatIsIndexeddb')}
                </a>
              </Text>
            </Box>
          </Dialog>
        </Box>
      </SplashScreen>
    );
  }

  return children;
}
