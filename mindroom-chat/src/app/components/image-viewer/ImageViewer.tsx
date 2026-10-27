import { useTranslation } from 'react-i18next';
import React, { useCallback, useRef } from 'react';
import classNames from 'classnames';
import { Box, Chip, Icon, IconButton, Icons, Spinner, Text, as } from 'folds';
import { Header } from '../glass/GlassPrimitives';
import * as css from './ImageViewer.css';
import { useZoom } from '../../hooks/useZoom';
import { usePan } from '../../hooks/usePan';
import { downloadMedia } from '../../utils/matrix';
import { saveFile } from '../../mindroom/native/nativeFileSave';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';

export type ImageViewerProps = {
  alt: string;
  src: string;
  requestClose: () => void;
};

export const ImageViewer = as<'div', ImageViewerProps>(
  ({ className, alt, src, requestClose, ...props }, ref) => {
    const { t } = useTranslation();
    const { zoom, zoomIn, zoomOut, setZoom, zoomTargetRef, isZooming } = useZoom(0.2);
    const { pan, cursor, isPanning, ...panHandlers } = usePan(zoom !== 1);
    const downloadedFileRef = useRef<{ src: string; blob: Blob }>();

    const [downloadState, download] = useAsyncCallback(
      useCallback(async () => {
        let fileContent = downloadedFileRef.current?.src === src && downloadedFileRef.current.blob;
        if (!fileContent) {
          fileContent = await downloadMedia(src);
          downloadedFileRef.current = { src, blob: fileContent };
        }
        await saveFile(fileContent, alt);
      }, [src, alt])
    );
    const downloadLoading = downloadState.status === AsyncStatus.Loading;
    const downloadError = downloadState.status === AsyncStatus.Error;
    const handleDownload = () => {
      void download().catch(() => undefined);
    };

    return (
      <Box
        className={classNames(css.ImageViewer, className)}
        direction="Column"
        data-image-viewer="true"
        {...props}
        ref={ref}
      >
        <Header className={css.ImageViewerHeader} size="400">
          <Box grow="Yes" alignItems="Center" gap="200">
            <IconButton size="300" radii="300" onClick={requestClose}>
              <Icon data-directional size="50" src={Icons.ArrowLeft} />
            </IconButton>
            <Text size="T300" truncate>
              {alt}
            </Text>
          </Box>
          <Box shrink="No" alignItems="Center" gap="200">
            <IconButton
              variant={zoom < 1 ? 'Success' : 'SurfaceVariant'}
              outlined={zoom < 1}
              size="300"
              radii="Pill"
              onClick={zoomOut}
              aria-label={t('sharedUi.imageViewer.zoomOut')}
            >
              <Icon size="50" src={Icons.Minus} />
            </IconButton>
            <Chip variant="SurfaceVariant" radii="Pill" onClick={() => setZoom(zoom === 1 ? 2 : 1)}>
              <Text size="B300">{Math.round(zoom * 100)}%</Text>
            </Chip>
            <IconButton
              variant={zoom > 1 ? 'Success' : 'SurfaceVariant'}
              outlined={zoom > 1}
              size="300"
              radii="Pill"
              onClick={zoomIn}
              aria-label={t('sharedUi.imageViewer.zoomIn')}
            >
              <Icon size="50" src={Icons.Plus} />
            </IconButton>
            <Chip
              variant={downloadError ? 'Critical' : 'Primary'}
              onClick={handleDownload}
              disabled={downloadLoading}
              radii="300"
              before={
                downloadLoading ? (
                  <Spinner size="100" variant="Primary" />
                ) : (
                  <Icon size="50" src={downloadError ? Icons.Warning : Icons.Download} />
                )
              }
            >
              <Text size="B300">
                {downloadLoading
                  ? t('sharedUi.imageViewer.saving')
                  : downloadError
                  ? t('sharedUi.imageViewer.retryDownload')
                  : t('sharedUi.imageViewer.download')}
              </Text>
            </Chip>
          </Box>
        </Header>
        <Box
          grow="Yes"
          className={css.ImageViewerContent}
          justifyContent="Center"
          alignItems="Center"
          ref={zoomTargetRef}
          {...panHandlers}
        >
          <img
            className={css.ImageViewerImg}
            style={{
              cursor,
              transform: `translate(${pan.translateX}px, ${pan.translateY}px) scale(${zoom})`,
              transition: isZooming || isPanning ? 'none' : undefined,
            }}
            src={src}
            alt={alt}
            draggable={false}
          />
        </Box>
      </Box>
    );
  }
);
