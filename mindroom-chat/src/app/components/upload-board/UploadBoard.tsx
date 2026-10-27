import { useTranslation } from 'react-i18next';
import React, { ReactNode } from 'react';
import { Badge, Box, Chip, Icon, Icons, Spinner, Text, as, percent } from 'folds';
import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import { Header } from '../glass/GlassPrimitives';

import * as css from './UploadBoard.css';
import { TUploadFamilyObserverAtom, Upload, UploadStatus } from '../../state/upload';

type UploadBoardProps = {
  header: ReactNode;
};
export const UploadBoard = as<'div', UploadBoardProps>(({ header, children, ...props }, ref) => (
  <Box className={css.UploadBoardBase} {...props} ref={ref}>
    <Box className={css.UploadBoardContainer} justifyContent="End">
      <Box className={classNames(css.UploadBoard)} direction="Column">
        <Box grow="Yes" direction="Column">
          {children}
        </Box>
        <Box direction="Column" shrink="No">
          {header}
        </Box>
      </Box>
    </Box>
  </Box>
));

type UploadBoardHeaderProps = {
  open: boolean;
  onToggle: () => void;
  uploadFamilyObserverAtom: TUploadFamilyObserverAtom;
  onCancel: (uploads: Upload[]) => void;
};

export function UploadBoardHeader({
  open,
  onToggle,
  uploadFamilyObserverAtom,
  onCancel,
}: UploadBoardHeaderProps) {
  const { t } = useTranslation();
  const uploads = useAtomValue(uploadFamilyObserverAtom);

  const isError = uploads.some((upload) => upload.status === UploadStatus.Error);
  const isUploading = uploads.some(
    (upload) => upload.status === UploadStatus.Idle || upload.status === UploadStatus.Loading
  );
  const progress = uploads.reduce(
    (acc, upload) => {
      acc.total += upload.file.size;
      if (upload.status === UploadStatus.Loading) {
        acc.loaded += upload.progress.loaded;
      }
      if (upload.status === UploadStatus.Success) {
        acc.loaded += upload.file.size;
      }
      return acc;
    },
    { loaded: 0, total: 0 }
  );

  const handleCancel = () => onCancel(uploads);

  return (
    <Header size="400" appearance="plain">
      <Box
        as="button"
        style={{ cursor: 'pointer' }}
        onClick={onToggle}
        className={css.UploadBoardHeaderContent}
        alignItems="Center"
        grow="Yes"
        gap="100"
      >
        <Icon data-directional src={open ? Icons.ChevronTop : Icons.ChevronRight} size="50" />
        <Text size="H6">{t('sharedUi.uploadBoard.files')}</Text>
      </Box>
      <Box className={css.UploadBoardHeaderContent} alignItems="Center" gap="100">
        {isError && !open && (
          <Badge variant="Critical" fill="Solid" radii="300">
            <Text size="L400">{t('sharedUi.uploadBoard.uploadFailed')}</Text>
          </Badge>
        )}
        {!isError && !open && (
          <>
            <Badge variant="Secondary" fill="Solid" radii="Pill">
              <Text size="L400">{Math.round(percent(0, progress.total, progress.loaded))}%</Text>
            </Badge>
            {isUploading && <Spinner variant="Secondary" size="200" />}
          </>
        )}
        {open && (
          <Chip
            as="button"
            onClick={handleCancel}
            variant="SurfaceVariant"
            radii="Pill"
            after={<Icon src={Icons.Cross} size="50" />}
          >
            <Text size="B300">
              {uploads.length === 1
                ? t('sharedUi.uploadBoard.remove')
                : t('sharedUi.uploadBoard.removeAll')}
            </Text>
          </Chip>
        )}
      </Box>
    </Header>
  );
}

export const UploadBoardContent = as<'div'>(({ className, children, ...props }, ref) => (
  <Box
    className={classNames(css.UploadBoardContent, className)}
    direction="Column"
    gap="200"
    {...props}
    ref={ref}
  >
    {children}
  </Box>
));
