import { useTranslation } from 'react-i18next';
import React, { useEffect } from 'react';
import { Chip, Icon, IconButton, Icons, Text, color } from 'folds';
import { UploadCard, UploadCardError, CompactUploadCardProgress } from './UploadCard';
import { TUploadAtom, UploadStatus, UploadSuccess, useBindUploadAtom } from '../../state/upload';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import {
  MatrixUploadKind,
  TUploadContent,
  getMatrixUploadErrorMessage,
  getMatrixUploadErrorStage,
  getMatrixUploadTooLargeMessage,
} from '../../utils/matrix';
import { getFileTypeIcon } from '../../utils/common';
import { useMediaConfig } from '../../hooks/useMediaConfig';

type CompactUploadCardRendererProps = {
  isEncrypted?: boolean;
  uploadKind?: MatrixUploadKind;
  uploadAtom: TUploadAtom;
  onRemove: (file: TUploadContent) => void;
  onComplete?: (upload: UploadSuccess) => void;
};
export function CompactUploadCardRenderer({
  isEncrypted,
  uploadKind = 'file',
  uploadAtom,
  onRemove,
  onComplete,
}: CompactUploadCardRendererProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const mediaConfig = useMediaConfig();
  const allowSize = mediaConfig['m.upload.size'] ?? Infinity;
  const maxUploadSize = Number.isFinite(allowSize) ? allowSize : undefined;

  const { upload, startUpload, cancelUpload } = useBindUploadAtom(mx, uploadAtom, isEncrypted);
  const { file } = upload;
  const fileSizeExceeded = file.size >= allowSize;

  if (upload.status === UploadStatus.Idle && !fileSizeExceeded) {
    startUpload();
  }

  const removeUpload = () => {
    cancelUpload();
    onRemove(file);
  };

  useEffect(() => {
    if (upload.status === UploadStatus.Success) {
      onComplete?.(upload);
    }
  }, [upload, onComplete]);

  return (
    <UploadCard
      compact
      outlined
      radii="300"
      before={<Icon src={getFileTypeIcon(Icons, file.type)} />}
      after={
        <>
          {upload.status === UploadStatus.Error && (
            <Chip
              as="button"
              onClick={startUpload}
              aria-label={t('sharedUi.compactUploadCardRenderer.retryUpload')}
              variant="Critical"
              radii="Pill"
              outlined
            >
              <Text size="B300">{t('sharedUi.compactUploadCardRenderer.retry')}</Text>
            </Chip>
          )}
          <IconButton
            onClick={removeUpload}
            aria-label={t('sharedUi.compactUploadCardRenderer.cancelUpload')}
            variant="SurfaceVariant"
            radii="Pill"
            size="300"
          >
            <Icon src={Icons.Cross} size="200" />
          </IconButton>
        </>
      }
    >
      {upload.status === UploadStatus.Success ? (
        <>
          <Text size="H6" truncate>
            {file.name}
          </Text>
          <Icon style={{ color: color.Success.Main }} src={Icons.Check} size="100" />
        </>
      ) : (
        <>
          {upload.status === UploadStatus.Idle && !fileSizeExceeded && (
            <CompactUploadCardProgress sentBytes={0} totalBytes={file.size} />
          )}
          {upload.status === UploadStatus.Loading && (
            <CompactUploadCardProgress sentBytes={upload.progress.loaded} totalBytes={file.size} />
          )}
          {upload.status === UploadStatus.Error && (
            <UploadCardError>
              <Text size="T200">
                {getMatrixUploadErrorMessage(
                  upload.error,
                  getMatrixUploadErrorStage(upload.error) ?? 'upload',
                  {
                    uploadKind,
                    fileSize: file.size,
                    maxUploadSize,
                  }
                )}
              </Text>
            </UploadCardError>
          )}
          {upload.status === UploadStatus.Idle && fileSizeExceeded && (
            <UploadCardError>
              <Text size="T200">
                {getMatrixUploadTooLargeMessage({
                  uploadKind,
                  fileSize: file.size,
                  maxUploadSize: allowSize,
                })}
              </Text>
            </UploadCardError>
          )}
        </>
      )}
    </UploadCard>
  );
}
