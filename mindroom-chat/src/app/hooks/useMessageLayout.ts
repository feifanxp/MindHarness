import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageLayout } from '../state/settings';

export type MessageLayoutItem = {
  name: string;
  layout: MessageLayout;
};

export const useMessageLayoutItems = (): MessageLayoutItem[] => {
  const { t } = useTranslation();

  return useMemo(
    () => [
      {
        layout: MessageLayout.Modern,
        name: t('options.messageLayout.modern'),
      },
      {
        layout: MessageLayout.Compact,
        name: t('options.messageLayout.compact'),
      },
      {
        layout: MessageLayout.Bubble,
        name: t('options.messageLayout.bubble'),
      },
    ],
    [t]
  );
};
