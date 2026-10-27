import React from 'react';
import { Box, Text, Chip } from 'folds';
import { useTranslation } from 'react-i18next';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { copyToClipboard } from '../../../utils/dom';
import { useTimeoutToggle } from '../../../hooks/useTimeoutToggle';

export function MatrixId() {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const userId = mx.getUserId()!;
  const [copied, setCopied] = useTimeoutToggle();

  const handleCopy = async () => {
    if (await copyToClipboard(userId)) setCopied();
  };

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">{t('featureUi.settings.account.matrixId.matrixId')}</Text>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title={userId}
          after={
            <Chip variant={copied ? 'Success' : 'Secondary'} radii="Pill" onClick={handleCopy}>
              <Text size="T200">
                {copied
                  ? t('featureUi.settings.account.matrixId.copied')
                  : t('featureUi.settings.account.matrixId.copy')}
              </Text>
            </Chip>
          }
        />
      </SequenceCard>
    </Box>
  );
}
