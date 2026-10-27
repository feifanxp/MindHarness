import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import React from 'react';
import { Box, Text } from 'folds';
import classNames from 'classnames';
import type { EventAttachmentOwner } from './eventAttachments';
import { DownloadFile, ReadTextFile } from '../../components/message';
import { TextViewer } from '../../components/text-viewer';
import { bytesToSize } from '../../utils/common';
import { FALLBACK_MIMETYPE } from '../../utils/mimeTypes';
import * as css from './MindroomPasteAttachmentContent.css';
import type { MindroomPasteAttachmentFile } from './pasteAttachmentMarker';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';
import { useGlassHighlight } from '../../components/glass/liquid/useLiquidGlass';

type MindroomPasteAttachmentContentProps = {
  owner?: EventAttachmentOwner;
  attachment: MindroomPasteAttachmentFile;
  outlined?: boolean;
};

const getPasteAttachmentDetail = (
  { chars, size }: Pick<MindroomPasteAttachmentFile, 'chars' | 'size'>,
  t: TFunction,
  locale: string
): string | undefined => {
  if (typeof chars === 'number') {
    return t('mindroomUi.messages.mindroomPasteAttachmentContent.characterCount', {
      count: chars,
      formattedCount: chars.toLocaleString(locale),
    });
  }
  if (typeof size === 'number') {
    return bytesToSize(size);
  }
  return undefined;
};

export function MindroomPasteAttachmentContent({
  owner,
  attachment,
  outlined,
}: MindroomPasteAttachmentContentProps) {
  const glassRef = useGlassHighlight<HTMLDivElement>();
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const { encryptedFile, fileName, mimeType = FALLBACK_MIMETYPE, mxcUri, size } = attachment;
  const detail = getPasteAttachmentDetail(attachment, t, language);
  const fileInfo = {
    mimetype: mimeType,
    ...(typeof size === 'number' ? { size } : {}),
  };

  return (
    <Box ref={glassRef} className={classNames(css.Card, outlined && css.Outlined)}>
      <Box className={css.Header}>
        <Text className={css.Title} size="T300">
          {t('mindroomUi.messages.mindroomPasteAttachmentContent.pastedText')}
        </Text>
        {detail && (
          <Text className={css.Meta} size="B300" truncate>
            {detail}
          </Text>
        )}
      </Box>
      <Box className={css.Details}>
        <Text className={css.FileName} title={fileName} size="B300" truncate>
          {fileName}
        </Text>
        <Box className={css.Actions}>
          <ReadTextFile
            owner={owner}
            body={fileName}
            mimeType={mimeType}
            url={mxcUri}
            encInfo={encryptedFile}
            buttonText={t('mindroomUi.messages.mindroomPasteAttachmentContent.open')}
            errorButtonText={t('mindroomUi.messages.mindroomPasteAttachmentContent.retry')}
            buttonSize="300"
            renderViewer={(props) => <TextViewer {...props} />}
          />
          <DownloadFile
            owner={owner}
            body={fileName}
            mimeType={mimeType}
            url={mxcUri}
            encInfo={encryptedFile}
            info={fileInfo}
            buttonText={t('mindroomUi.messages.mindroomPasteAttachmentContent.download')}
            errorButtonText={t('mindroomUi.messages.mindroomPasteAttachmentContent.retry')}
            buttonSize="300"
          />
        </Box>
      </Box>
    </Box>
  );
}
