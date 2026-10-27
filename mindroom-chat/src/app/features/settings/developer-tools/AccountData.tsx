import React, { useCallback, useState } from 'react';
import { Box, Text, Icon, Icons, Button } from 'folds';
import { useTranslation } from 'react-i18next';
import { MenuItem } from '../../../components/glass/GlassPrimitives';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useAccountDataCallback } from '../../../hooks/useAccountDataCallback';
import { CutoutCard } from '../../../components/cutout-card';

type AccountDataProps = {
  expand: boolean;
  onExpandToggle: (expand: boolean) => void;
  onSelect: (type: string | null) => void;
};
export function AccountData({ expand, onExpandToggle, onSelect }: AccountDataProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const [accountDataTypes, setAccountDataKeys] = useState(() =>
    Array.from(mx.store.accountData.keys())
  );

  useAccountDataCallback(
    mx,
    useCallback(() => {
      setAccountDataKeys(Array.from(mx.store.accountData.keys()));
    }, [mx])
  );

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">{t('featureUi.settings.developerTools.accountData.accountData')}</Text>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title={t('featureUi.settings.developerTools.accountData.global')}
          description={t(
            'featureUi.settings.developerTools.accountData.dataStoredInYourGlobalAccountData'
          )}
          after={
            <Button
              onClick={() => onExpandToggle(!expand)}
              variant="Secondary"
              fill="Soft"
              size="300"
              radii="300"
              outlined
              before={
                <Icon src={expand ? Icons.ChevronTop : Icons.ChevronBottom} size="100" filled />
              }
            >
              <Text size="B300">
                {expand
                  ? t('featureUi.settings.developerTools.accountData.collapse')
                  : t('featureUi.settings.developerTools.accountData.expand')}
              </Text>
            </Button>
          }
        />
        {expand && (
          <Box direction="Column" gap="100">
            <Box justifyContent="SpaceBetween">
              <Text size="L400">{t('featureUi.settings.developerTools.accountData.events')}</Text>
              <Text size="L400">
                {t('featureUi.settings.developerTools.accountData.total', {
                  count: accountDataTypes.length,
                })}
              </Text>
            </Box>
            <CutoutCard>
              <MenuItem
                variant="Surface"
                fill="None"
                size="300"
                radii="0"
                before={<Icon size="50" src={Icons.Plus} />}
                onClick={() => onSelect(null)}
              >
                <Box grow="Yes">
                  <Text size="T200" truncate>
                    {t('featureUi.settings.developerTools.accountData.addNew')}
                  </Text>
                </Box>
              </MenuItem>
              {accountDataTypes.sort().map((type) => (
                <MenuItem
                  key={type}
                  variant="Surface"
                  fill="None"
                  size="300"
                  radii="0"
                  after={<Icon data-directional size="50" src={Icons.ChevronRight} />}
                  onClick={() => onSelect(type)}
                >
                  <Box grow="Yes">
                    <Text size="T200" truncate>
                      {type}
                    </Text>
                  </Box>
                </MenuItem>
              ))}
            </CutoutCard>
          </Box>
        )}
      </SequenceCard>
    </Box>
  );
}
