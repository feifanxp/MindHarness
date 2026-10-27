import React, { useRef, useState } from 'react';
import { Box, color, Switch, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { SequenceCard } from '../../components/sequence-card';
import { SettingTile } from '../../components/setting-tile';
import { useClientConfig } from '../../hooks/useClientConfig';
import {
  useMindroomAccountSettings,
  useSetMindroomAccountSettings,
} from './useMindroomAccountSettings';
import type { MindroomAccountSettings } from './mindroomAccountSettings';

type MindroomInterfaceSettingsProps = {
  className?: string;
};

type MindroomBooleanSetting = keyof Pick<
  MindroomAccountSettings,
  'simpleMode' | 'showCanvasesInSidebar'
>;

type MindroomAccountSwitchProps = {
  setting: MindroomBooleanSetting;
  title: string;
  description: string;
};

function MindroomAccountSwitch({ setting, title, description }: MindroomAccountSwitchProps) {
  const { t } = useTranslation();
  const settings = useMindroomAccountSettings();
  const setAccountSettings = useSetMindroomAccountSettings();
  // setAccountData only resolves once the change echoes back over sync, so
  // show the requested value immediately and hand back to the store when the
  // write settles (echo arrived, or failed and the stored value still rules).
  const [pending, setPending] = useState<boolean>();
  // A failed write snaps the switch back to the stored value; explain why
  // instead of failing silently.
  const [saveFailed, setSaveFailed] = useState(false);
  const requestGeneration = useRef(0);

  const handleChange = (next: boolean) => {
    requestGeneration.current += 1;
    const generation = requestGeneration.current;
    setPending(next);
    setSaveFailed(false);
    setAccountSettings({ [setting]: next })
      .catch(() => {
        if (requestGeneration.current === generation) setSaveFailed(true);
      })
      .finally(() => {
        if (requestGeneration.current === generation) setPending(undefined);
      });
  };

  return (
    <SettingTile
      title={title}
      description={description}
      after={
        <Switch variant="Primary" value={pending ?? settings[setting]} onChange={handleChange} />
      }
    >
      {saveFailed && (
        <Text size="T200" style={{ color: color.Critical.Main }}>
          {t('settings.general.interface.saveFailed')}
        </Text>
      )}
    </SettingTile>
  );
}

/**
 * The "Interface" group at the top of Settings → General. Its switches are
 * backed by `io.mindroom.settings` account data. This group must stay visible
 * while simple mode is ON — it is the way back out.
 */
export function MindroomInterfaceSettings({ className }: MindroomInterfaceSettingsProps) {
  const { t } = useTranslation();
  const canvasesEnabled = useClientConfig().mindroom?.canvas?.enabled === true;

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">{t('settings.general.interface.sectionTitle')}</Text>
      <SequenceCard className={className} variant="SurfaceVariant" direction="Column" gap="400">
        <MindroomAccountSwitch
          setting="simpleMode"
          title={t('settings.general.interface.simpleMode')}
          description={t('settings.general.interface.simpleModeDescription')}
        />
        {canvasesEnabled && (
          <MindroomAccountSwitch
            setting="showCanvasesInSidebar"
            title={t('settings.general.interface.showCanvasesInSidebar')}
            description={t('settings.general.interface.showCanvasesInSidebarDescription')}
          />
        )}
      </SequenceCard>
    </Box>
  );
}
