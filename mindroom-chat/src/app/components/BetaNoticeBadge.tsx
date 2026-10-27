import { useTranslation } from 'react-i18next';
import React from 'react';
import { TooltipProvider, Tooltip, Box, Text, Badge, toRem } from 'folds';

export function BetaNoticeBadge() {
  const { t } = useTranslation();
  return (
    <TooltipProvider
      position="Right"
      align="Center"
      tooltip={
        <Tooltip style={{ maxWidth: toRem(200) }}>
          <Box direction="Column">
            <Text size="L400">{t('sharedUi.betaNoticeBadge.notice')}</Text>
            <Text size="T200">
              {t('sharedUi.betaNoticeBadge.thisFeatureIsUnderTestingAndMayChangeOverTime')}
            </Text>
          </Box>
        </Tooltip>
      }
    >
      {(triggerRef) => (
        <Badge size="500" tabIndex={0} ref={triggerRef} variant="Primary" fill="Solid">
          <Text size="L400">{t('sharedUi.betaNoticeBadge.beta')}</Text>
        </Badge>
      )}
    </TooltipProvider>
  );
}
