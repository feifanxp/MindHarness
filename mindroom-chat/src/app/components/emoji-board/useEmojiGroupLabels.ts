import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { EmojiGroupId } from '../../plugins/emoji';

export type IEmojiGroupLabels = Record<EmojiGroupId, string>;

export const useEmojiGroupLabels = (): IEmojiGroupLabels => {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      [EmojiGroupId.People]: t('sharedUi.emojiGroups.smileysPeople'),
      [EmojiGroupId.Nature]: t('sharedUi.emojiGroups.animalsNature'),
      [EmojiGroupId.Food]: t('sharedUi.emojiGroups.foodDrinks'),
      [EmojiGroupId.Activity]: t('sharedUi.emojiGroups.activity'),
      [EmojiGroupId.Travel]: t('sharedUi.emojiGroups.travelPlaces'),
      [EmojiGroupId.Object]: t('sharedUi.emojiGroups.objects'),
      [EmojiGroupId.Symbol]: t('sharedUi.emojiGroups.symbols'),
      [EmojiGroupId.Flag]: t('sharedUi.emojiGroups.flags'),
    }),
    [t]
  );
};
