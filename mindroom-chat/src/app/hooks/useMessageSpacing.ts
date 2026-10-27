import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSpacing } from '../state/settings';

export type MessageSpacingItem = {
  name: string;
  spacing: MessageSpacing;
};

export const useMessageSpacingItems = (): MessageSpacingItem[] => {
  const { t } = useTranslation();

  return useMemo(
    () => [
      {
        spacing: '0',
        name: t('options.messageSpacing.none'),
      },
      {
        spacing: '100',
        name: t('options.messageSpacing.ultraSmall'),
      },
      {
        spacing: '200',
        name: t('options.messageSpacing.extraSmall'),
      },
      {
        spacing: '300',
        name: t('options.messageSpacing.small'),
      },
      {
        spacing: '400',
        name: t('options.messageSpacing.normal'),
      },
      {
        spacing: '500',
        name: t('options.messageSpacing.large'),
      },
    ],
    [t]
  );
};
