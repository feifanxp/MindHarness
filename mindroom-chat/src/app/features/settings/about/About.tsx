/* eslint-disable jsx-a11y/anchor-has-content, jsx-a11y/control-has-associated-label -- Trans supplies each link's accessible text from the localized sentence. */
import React from 'react';
import { Box, Text, IconButton, Icon, Icons, Button, Spinner, Switch, config, toRem } from 'folds';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Page, PageContent, PageHeader, PageScroll } from '../../../components/page';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { clearAllCacheAndReload } from '../../../../client/initMatrix';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useClientConfig } from '../../../hooks/useClientConfig';
import {
  MINDROOM_CLIENT_BRANDING,
  getMindroomWelcomePageContent,
} from '../../../mindroom/branding/clientBranding';
import { isNativeIOS } from '../../../mindroom/native/nativeSso';
import { saveFile } from '../../../mindroom/native/nativeFileSave';
import { getFlightRecorderStatus } from '../../../mindroom/diagnostics/flightRecorder';
import {
  clearDeepTrace,
  getDeepTraceEnabled,
  getDeepTraceRuntimeStatus,
  setDeepTraceEnabled,
  subscribeDeepTraceStatus,
  type DeepTraceRuntimeStatus,
} from '../../../mindroom/diagnostics/deepTrace';
import { buildDiagnosticsExport } from '../../../mindroom/diagnostics/diagnosticsExport';
import { APP_RELEASE_VERSION } from '../../../../appVersion';

type AboutProps = {
  requestClose: () => void;
};

type DeepTraceError = 'storage' | 'preference' | undefined;

const getDeepTraceDescription = ({
  t,
  runtimeStatus,
  enabled,
  error,
}: {
  t: TFunction;
  runtimeStatus: DeepTraceRuntimeStatus;
  enabled: boolean;
  error: DeepTraceError;
}): string => {
  let description: string;

  if (runtimeStatus === 'memory-only') {
    description = t('featureUi.settings.about.deepTraceMemoryOnly');
  } else if (runtimeStatus === 'unavailable') {
    description = enabled
      ? t('featureUi.settings.about.deepTraceEnabledStorageUnavailable')
      : t('featureUi.settings.about.traceStorageUnavailable');
  } else if (error === 'storage') {
    description = t('featureUi.settings.about.traceStorageUnavailable');
  } else if (runtimeStatus === 'recording') {
    description = t('featureUi.settings.about.deepTraceRecording');
  } else if (runtimeStatus === 'starting') {
    description = t('featureUi.settings.about.deepTraceStarting');
  } else {
    description = t('featureUi.settings.about.deepTraceOff');
  }

  if (error === 'preference') {
    description = t('featureUi.settings.about.deepTracePreferenceSaveFailed', { description });
  }

  return description;
};

export function About({ requestClose }: AboutProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const clientConfig = useClientConfig();
  const { subtitle } = getMindroomWelcomePageContent(clientConfig.welcome, t);
  const [clearing, setClearing] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [exportError, setExportError] = React.useState(false);
  const [deepTracing, setDeepTracing] = React.useState(getDeepTraceEnabled);
  const [deepTraceRuntimeStatus, setDeepTraceRuntimeStatus] =
    React.useState(getDeepTraceRuntimeStatus);
  const [deepTraceError, setDeepTraceError] = React.useState<DeepTraceError>();
  const [deepTraceChanging, setDeepTraceChanging] = React.useState(false);
  const [clearingDeepTrace, setClearingDeepTrace] = React.useState(false);
  const deepTraceChangePending = React.useRef(false);
  const nativeIOS = isNativeIOS();
  const diagnosticsStatus = getFlightRecorderStatus();
  const diagnosticsDescription = {
    unexpected: t('featureUi.settings.about.diagnosticsUnexpected'),
    none: t('featureUi.settings.about.diagnosticsNone'),
    unavailable: t('featureUi.settings.about.diagnosticsUnavailable'),
  }[diagnosticsStatus];
  const diagnosticsFullDescription =
    exportError && diagnosticsStatus !== 'unavailable'
      ? t('featureUi.settings.about.diagnosticsExportFailed', {
          description: diagnosticsDescription,
        })
      : diagnosticsDescription;

  React.useEffect(
    () =>
      subscribeDeepTraceStatus((status) => {
        setDeepTraceRuntimeStatus(status);
        if (!deepTraceChangePending.current) {
          setDeepTraceChanging(status === 'starting');
        }
        if (status === 'unavailable') {
          setDeepTracing(getDeepTraceEnabled());
          setDeepTraceError('storage');
        } else if (status === 'starting') {
          setDeepTracing(true);
          setDeepTraceError(undefined);
        } else if (status === 'recording' || status === 'memory-only') {
          setDeepTracing(true);
          setDeepTraceError(undefined);
        } else {
          setDeepTracing(false);
        }
      }),
    []
  );

  const handleClearCache = async () => {
    if (clearing) return;

    setClearing(true);

    try {
      await clearAllCacheAndReload(mx);
    } catch {
      setClearing(false);
    }
  };

  const handleExportDiagnostics = async () => {
    if (exporting) return;

    setExporting(true);
    setExportError(false);

    try {
      const { blob, fileName } = await buildDiagnosticsExport();
      await saveFile(blob, fileName);
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  };

  const handleDeepTraceChange = async (enabled: boolean) => {
    if (deepTraceChangePending.current) return;
    deepTraceChangePending.current = true;
    setDeepTraceChanging(true);
    setDeepTracing(enabled);
    setDeepTraceError(undefined);
    let saved = false;
    try {
      saved = await setDeepTraceEnabled(enabled);
    } catch {
      saved = false;
    }
    if (!saved) {
      setDeepTraceError(enabled ? 'storage' : 'preference');
    }
    setDeepTracing(enabled ? getDeepTraceEnabled() : false);
    deepTraceChangePending.current = false;
    setDeepTraceChanging(false);
  };

  const handleClearDeepTrace = async () => {
    if (clearingDeepTrace) return;
    setClearingDeepTrace(true);
    setDeepTraceError(undefined);
    try {
      await clearDeepTrace();
    } catch {
      setDeepTraceError('storage');
    } finally {
      setClearingDeepTrace(false);
    }
  };

  return (
    <Page>
      <PageScroll
        header={
          <PageHeader outlined={false}>
            <Box grow="Yes" gap="200">
              <Box grow="Yes" alignItems="Center" gap="200">
                <Text size="H3" truncate>
                  {t('featureUi.settings.about.title')}
                </Text>
              </Box>
              <Box shrink="No">
                <IconButton onClick={requestClose} variant="Surface">
                  <Icon src={Icons.Cross} />
                </IconButton>
              </Box>
            </Box>
          </PageHeader>
        }
      >
        <PageContent>
          <Box direction="Column" gap="700">
            <Box gap="400">
              <Box shrink="No">
                <img
                  style={{ width: toRem(60), height: toRem(60) }}
                  src={MINDROOM_CLIENT_BRANDING.logoSrc}
                  alt={MINDROOM_CLIENT_BRANDING.logoAlt}
                />
              </Box>
              <Box direction="Column" gap="300">
                <Box direction="Column" gap="100">
                  <Box gap="100" alignItems="End" wrap="Wrap">
                    <Text size="H3">{MINDROOM_CLIENT_BRANDING.appName}</Text>
                    <Text size="T200">{APP_RELEASE_VERSION}</Text>
                  </Box>
                  <Text>{subtitle}</Text>
                </Box>

                <Box gap="200" wrap="Wrap">
                  <Button
                    as="a"
                    href={MINDROOM_CLIENT_BRANDING.sourceUrl}
                    rel="noreferrer noopener"
                    target="_blank"
                    variant="Secondary"
                    fill="Soft"
                    size="300"
                    radii="300"
                    before={<Icon src={Icons.Code} size="100" filled />}
                    outlined
                  >
                    <Text size="B300">{t('featureUi.settings.about.sourceCode')}</Text>
                  </Button>
                  <Button
                    as="a"
                    href="https://cinny.in/#sponsor"
                    rel="noreferrer noopener"
                    target="_blank"
                    variant="Critical"
                    fill="Soft"
                    size="300"
                    radii="300"
                    before={<Icon src={Icons.Heart} size="100" filled />}
                    outlined
                  >
                    <Text size="B300">{t('featureUi.settings.about.support')}</Text>
                  </Button>
                </Box>
              </Box>
            </Box>
            <Box direction="Column" gap="100">
              <Text size="L400">{t('featureUi.settings.about.options')}</Text>
              <SequenceCard
                className={SequenceCardStyle}
                variant="SurfaceVariant"
                direction="Column"
                gap="400"
              >
                <SettingTile
                  title={t('featureUi.settings.about.clearCacheAndReload')}
                  description={t('featureUi.settings.about.clearCacheDescription')}
                  after={
                    <Button
                      onClick={handleClearCache}
                      variant="Secondary"
                      fill="Soft"
                      size="300"
                      radii="300"
                      outlined
                      disabled={clearing}
                      before={clearing && <Spinner size="200" variant="Secondary" fill="Soft" />}
                    >
                      <Text size="B300">
                        {clearing
                          ? t('featureUi.settings.about.clearing')
                          : t('featureUi.settings.about.clearCache')}
                      </Text>
                    </Button>
                  }
                />
                {nativeIOS && (
                  <SettingTile
                    title={t('featureUi.settings.about.deepDiagnosticTracing')}
                    description={getDeepTraceDescription({
                      t,
                      runtimeStatus: deepTraceRuntimeStatus,
                      enabled: deepTracing,
                      error: deepTraceError,
                    })}
                    after={
                      <Box alignItems="Center" gap="200">
                        <Button
                          onClick={handleClearDeepTrace}
                          variant="Secondary"
                          fill="Soft"
                          size="300"
                          radii="300"
                          outlined
                          disabled={clearingDeepTrace || deepTraceChanging}
                          before={
                            clearingDeepTrace && (
                              <Spinner size="200" variant="Secondary" fill="Soft" />
                            )
                          }
                        >
                          <Text size="B300">
                            {clearingDeepTrace
                              ? t('featureUi.settings.about.clearing')
                              : t('featureUi.settings.about.clearTrace')}
                          </Text>
                        </Button>
                        <Switch
                          variant="Primary"
                          value={deepTracing}
                          onChange={handleDeepTraceChange}
                          disabled={deepTraceChanging}
                        />
                      </Box>
                    }
                  />
                )}
                {nativeIOS && (
                  <SettingTile
                    title={t('featureUi.settings.about.onDeviceDiagnostics')}
                    description={diagnosticsFullDescription}
                    after={
                      <Button
                        onClick={handleExportDiagnostics}
                        variant="Secondary"
                        fill="Soft"
                        size="300"
                        radii="300"
                        outlined
                        disabled={exporting}
                        before={exporting && <Spinner size="200" variant="Secondary" fill="Soft" />}
                      >
                        <Text size="B300">
                          {exporting
                            ? t('featureUi.settings.about.exporting')
                            : t('featureUi.settings.about.exportDiagnostics')}
                        </Text>
                      </Button>
                    }
                  />
                )}
              </SequenceCard>
            </Box>
            <Box direction="Column" gap="100">
              <Text size="L400">{t('featureUi.settings.about.credits')}</Text>
              <SequenceCard
                className={SequenceCardStyle}
                variant="SurfaceVariant"
                direction="Column"
                gap="400"
              >
                <Box
                  as="ul"
                  direction="Column"
                  gap="200"
                  style={{
                    margin: 0,
                    paddingInlineStart: config.space.S400,
                  }}
                >
                  <li>
                    <Text size="T300">
                      <Trans
                        i18nKey="featureUi.settings.about.matrixSdkCredit"
                        components={{
                          sdk: (
                            <a
                              href="https://github.com/matrix-org/matrix-js-sdk"
                              rel="noreferrer noopener"
                              target="_blank"
                            />
                          ),
                          owner: (
                            <a
                              href="https://matrix.org/foundation"
                              rel="noreferrer noopener"
                              target="_blank"
                            />
                          ),
                          license: (
                            <a
                              href="http://www.apache.org/licenses/LICENSE-2.0"
                              rel="noreferrer noopener"
                              target="_blank"
                            />
                          ),
                        }}
                      />
                    </Text>
                  </li>
                  <li>
                    <Text size="T300">
                      <Trans
                        i18nKey="featureUi.settings.about.emojiFontCredit"
                        components={{
                          font: (
                            <a
                              href="https://github.com/mozilla/twemoji-colr"
                              target="_blank"
                              rel="noreferrer noopener"
                            />
                          ),
                          owner: (
                            <a
                              href="https://mozilla.org/"
                              target="_blank"
                              rel="noreferrer noopener"
                            />
                          ),
                          license: (
                            <a
                              href="http://www.apache.org/licenses/LICENSE-2.0"
                              target="_blank"
                              rel="noreferrer noopener"
                            />
                          ),
                        }}
                      />
                    </Text>
                  </li>
                  <li>
                    <Text size="T300">
                      <Trans
                        i18nKey="featureUi.settings.about.emojiArtCredit"
                        components={{
                          art: (
                            <a
                              href="https://twemoji.twitter.com"
                              target="_blank"
                              rel="noreferrer noopener"
                            />
                          ),
                          owner: (
                            <a
                              href="https://twemoji.twitter.com"
                              target="_blank"
                              rel="noreferrer noopener"
                            />
                          ),
                          license: (
                            <a
                              href="https://creativecommons.org/licenses/by/4.0/"
                              target="_blank"
                              rel="noreferrer noopener"
                            />
                          ),
                        }}
                      />
                    </Text>
                  </li>
                  <li>
                    <Text size="T300">
                      <Trans
                        i18nKey="featureUi.settings.about.soundResourcesCredit"
                        components={{
                          resources: (
                            <a
                              href="https://material.io/design/sound/sound-resources.html"
                              target="_blank"
                              rel="noreferrer noopener"
                            />
                          ),
                          owner: (
                            <a
                              href="https://google.com"
                              target="_blank"
                              rel="noreferrer noopener"
                            />
                          ),
                          license: (
                            <a
                              href="https://creativecommons.org/licenses/by/4.0/"
                              target="_blank"
                              rel="noreferrer noopener"
                            />
                          ),
                        }}
                      />
                    </Text>
                  </li>
                </Box>
              </SequenceCard>
            </Box>
          </Box>
        </PageContent>
      </PageScroll>
    </Page>
  );
}
