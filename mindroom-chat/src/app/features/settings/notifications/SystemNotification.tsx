import React, { useCallback } from 'react';
import { Box, Text, Switch, Button, color, Spinner } from 'folds';
import { IPusherRequest } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { getNotificationState, usePermissionState } from '../../../hooks/usePermission';
import { useEmailNotifications } from '../../../hooks/useEmailNotifications';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useAppLanguageCode } from '../../../hooks/useAppLanguageCode';
import {
  getMindroomEmailNotificationPusherData,
  MindroomNativeNotificationSettings,
} from '../../../mindroom/notifications/SystemNotificationMindroomExtensions';

function EmailNotification() {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const mx = useMatrixClient();
  const [result, refreshResult] = useEmailNotifications();

  const [setState, setEnable] = useAsyncCallback(
    useCallback(
      async (email: string, enable: boolean) => {
        if (enable) {
          await mx.setPusher({
            kind: 'email',
            app_id: 'm.email',
            pushkey: email,
            app_display_name: 'Email Notifications',
            device_display_name: email,
            lang: language,
            data: getMindroomEmailNotificationPusherData(),
            append: true,
          });
          return;
        }
        await mx.setPusher({
          pushkey: email,
          app_id: 'm.email',
          kind: null,
        } as unknown as IPusherRequest);
      },
      [language, mx]
    )
  );

  const handleChange = (value: boolean) => {
    if (result && result.email) {
      setEnable(result.email, value).then(() => {
        refreshResult();
      });
    }
  };

  return (
    <SettingTile
      title={t('featureUi.settings.notifications.systemNotification.emailNotification')}
      description={
        <>
          {result && !result.email && (
            <Text as="span" style={{ color: color.Critical.Main }} size="T200">
              {t(
                'featureUi.settings.notifications.systemNotification.yourAccountDoesNotHaveAnyEmail'
              )}
            </Text>
          )}
          {result &&
            result.email &&
            t('featureUi.settings.notifications.systemNotification.sendToEmailAddress', {
              email: result.email,
            })}
          {result === null && (
            <Text as="span" style={{ color: color.Critical.Main }} size="T200">
              {t('featureUi.settings.notifications.systemNotification.unexpectedError')}
            </Text>
          )}
          {result === undefined &&
            t('featureUi.settings.notifications.systemNotification.sendToEmail')}
        </>
      }
      after={
        <>
          {setState.status !== AsyncStatus.Loading &&
            typeof result === 'object' &&
            result?.email && <Switch value={result.enabled} onChange={handleChange} />}
          {(setState.status === AsyncStatus.Loading || result === undefined) && (
            <Spinner variant="Secondary" />
          )}
        </>
      }
    />
  );
}

export function SystemNotification() {
  const { t } = useTranslation();
  const notifPermission = usePermissionState('notifications', getNotificationState());
  const [showNotifications, setShowNotifications] = useSetting(settingsAtom, 'showNotifications');
  const [isNotificationSounds, setIsNotificationSounds] = useSetting(
    settingsAtom,
    'isNotificationSounds'
  );

  const requestNotificationPermission = () => {
    if ('Notification' in window) {
      window.Notification.requestPermission();
    }
  };

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">{t('featureUi.settings.notifications.systemNotification.system')}</Text>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title={t('featureUi.settings.notifications.systemNotification.desktopNotifications')}
          description={
            notifPermission === 'denied' ? (
              <Text as="span" style={{ color: color.Critical.Main }} size="T200">
                {'Notification' in window
                  ? t('featureUi.settings.notifications.systemNotification.permissionBlocked')
                  : t('featureUi.settings.notifications.systemNotification.notSupported')}
              </Text>
            ) : (
              <span>
                {t(
                  'featureUi.settings.notifications.systemNotification.showDesktopNotificationsWhenMessageArrive'
                )}
              </span>
            )
          }
          after={
            notifPermission === 'prompt' ? (
              <Button
                size="300"
                fill="Soft"
                outlined
                radii="300"
                onClick={requestNotificationPermission}
              >
                <Text size="B300">
                  {t('featureUi.settings.notifications.systemNotification.enable')}
                </Text>
              </Button>
            ) : (
              <Switch
                disabled={notifPermission !== 'granted'}
                value={showNotifications}
                onChange={setShowNotifications}
              />
            )
          }
        />
      </SequenceCard>
      <MindroomNativeNotificationSettings />
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title={t('featureUi.settings.notifications.systemNotification.notificationSound')}
          description={t(
            'featureUi.settings.notifications.systemNotification.playSoundWhenNewMessageArrive'
          )}
          after={<Switch value={isNotificationSounds} onChange={setIsNotificationSounds} />}
        />
      </SequenceCard>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <EmailNotification />
      </SequenceCard>
    </Box>
  );
}
