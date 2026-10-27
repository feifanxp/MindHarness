import { useTranslation } from 'react-i18next';
import React from 'react';
import { Box } from 'folds';
import { MatrixClient } from 'matrix-js-sdk';
import { EmojiItemInfo, EmojiType } from '../types';
import * as css from './styles.css';
import { PackImageReader } from '../../../plugins/custom-emoji';
import { IEmoji } from '../../../plugins/emoji';
import { mxcUrlToHttp } from '../../../utils/matrix';

export const getEmojiItemInfo = (element: Element): EmojiItemInfo | undefined => {
  const label = element.getAttribute('title');
  const type = element.getAttribute('data-emoji-type') as EmojiType | undefined;
  const data = element.getAttribute('data-emoji-data');
  const shortcode = element.getAttribute('data-emoji-shortcode');

  if (type && data && shortcode && label)
    return {
      type,
      data,
      shortcode,
      label,
    };
  return undefined;
};

type EmojiItemProps = {
  emoji: IEmoji;
};
export function EmojiItem({ emoji }: EmojiItemProps) {
  const { t } = useTranslation();
  return (
    <Box
      as="button"
      type="button"
      alignItems="Center"
      justifyContent="Center"
      className={css.EmojiItem}
      title={emoji.label}
      aria-label={t('sharedUi.item.value1Emoji', { value1: emoji.label })}
      data-emoji-type={EmojiType.Emoji}
      data-emoji-data={emoji.unicode}
      data-emoji-shortcode={emoji.shortcode}
    >
      {emoji.unicode}
    </Box>
  );
}

type CustomEmojiItemProps = {
  mx: MatrixClient;
  useAuthentication?: boolean;
  image: PackImageReader;
};
export function CustomEmojiItem({ mx, useAuthentication, image }: CustomEmojiItemProps) {
  const { t } = useTranslation();
  return (
    <Box
      as="button"
      type="button"
      alignItems="Center"
      justifyContent="Center"
      className={css.EmojiItem}
      title={image.body || image.shortcode}
      aria-label={t('sharedUi.item.value1Emoji', { value1: image.body || image.shortcode })}
      data-emoji-type={EmojiType.CustomEmoji}
      data-emoji-data={image.url}
      data-emoji-shortcode={image.shortcode}
    >
      <img
        loading="lazy"
        className={css.CustomEmojiImg}
        alt={image.body || image.shortcode}
        src={mxcUrlToHttp(mx, image.url, useAuthentication) ?? ''}
      />
    </Box>
  );
}

type StickerItemProps = {
  mx: MatrixClient;
  useAuthentication?: boolean;
  image: PackImageReader;
};

export function StickerItem({ mx, useAuthentication, image }: StickerItemProps) {
  const { t } = useTranslation();
  return (
    <Box
      as="button"
      type="button"
      alignItems="Center"
      justifyContent="Center"
      className={css.StickerItem}
      title={image.body || image.shortcode}
      aria-label={t('sharedUi.item.value1Emoji', { value1: image.body || image.shortcode })}
      data-emoji-type={EmojiType.Sticker}
      data-emoji-data={image.url}
      data-emoji-shortcode={image.shortcode}
    >
      <img
        loading="lazy"
        className={css.StickerImg}
        alt={image.body || image.shortcode}
        src={mxcUrlToHttp(mx, image.url, useAuthentication) ?? ''}
      />
    </Box>
  );
}
