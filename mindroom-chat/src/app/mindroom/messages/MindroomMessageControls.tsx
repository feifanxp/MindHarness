import type { MatrixEvent } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Icon,
  IconButton,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
  as,
  config,
} from 'folds';
import React, { ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import FocusTrap from 'focus-trap-react';
import { getEventAttachmentOwner } from './eventAttachments';
import { Dialog, Header, MenuItem } from '../../components/glass/GlassPrimitives';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { stopPropagation } from '../../utils/keyboard';
import { assignElementRef } from '../../utils/react';
import { MindroomAiRunInfo, getMindroomAiRunInfo } from './aiRun';
import {
  MindroomAiRunContextBarSegment,
  formatMindroomAiRunNumber,
  formatMindroomAiRunTimeToFirstToken,
  getMindroomAiRunContextBarSegments,
  getMindroomAiRunContextCacheLabel,
  getMindroomAiRunContextLabel,
  getMindroomAiRunModelLabel,
  getMindroomAiRunUsageCacheLabel,
  getMindroomAiRunUsageLabel,
} from './aiRunDisplay';
import {
  MindroomLongTextSource,
  getMindroomLongTextSource,
  getMindroomLongTextSourceIdentity,
} from './longText';
import {
  downloadMindroomLongTextSidecarBlob,
  getMindroomLongTextDownloadName,
} from './longTextDownload';
import { saveFile } from '../native/nativeFileSave';
import { useMindroomLongTextResolvedContent } from './MindroomLongTextText';
import * as css from './MindroomMessageControls.css';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';

export function useMindroomMessageControls(
  content: Record<string, unknown>,
  menuOpen: boolean,
  mEvent?: MatrixEvent
) {
  const longTextSource = useMemo(() => {
    const source = getMindroomLongTextSource(content);
    return source ? { ...source, owner: getEventAttachmentOwner(mEvent) } : undefined;
  }, [content, mEvent]);
  const resolvedLongTextContent = useMindroomLongTextResolvedContent(longTextSource, menuOpen);
  const longTextLoading = longTextSource !== undefined && resolvedLongTextContent === undefined;
  const aiRunInfo = getMindroomAiRunInfo(content);

  return {
    aiRunInfo,
    longTextLoading,
    longTextSource,
    resolvedLongTextContent,
  };
}

function MindroomAiRunDetail({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <Text size="T200">
      {label}: {value}
    </Text>
  );
}

const getMindroomAiRunContextBarSegmentClassName = (
  key: MindroomAiRunContextBarSegment['key']
): string => {
  if (key === 'cacheRead') {
    return `${css.AiRunContextBarSegment} ${css.AiRunContextBarSegmentCacheRead}`;
  }
  if (key === 'newInput') {
    return `${css.AiRunContextBarSegment} ${css.AiRunContextBarSegmentNewInput}`;
  }
  return `${css.AiRunContextBarSegment} ${css.AiRunContextBarSegmentReserve}`;
};

function MindroomAiRunContextBar({ info }: { info: MindroomAiRunInfo }) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const segments = getMindroomAiRunContextBarSegments(info, t, language);
  if (!segments) return null;

  return (
    <div
      className={css.AiRunContextBar}
      aria-label={t('mindroomUi.messages.mindroomMessageControls.requestContextWindow')}
    >
      {segments.map((segment) => (
        <div
          key={segment.key}
          className={getMindroomAiRunContextBarSegmentClassName(segment.key)}
          style={{ width: `${segment.percentage}%` }}
          title={segment.title}
          aria-label={t('mindroomUi.messages.mindroomMessageControls.segmentTokenCount', {
            label: segment.label,
            count: segment.tokens,
            formattedCount: formatMindroomAiRunNumber(segment.tokens, language),
          })}
        />
      ))}
    </div>
  );
}

function MindroomAiRunInfoDialog({
  info,
  open,
  onClose,
  returnFocusRef,
}: {
  info: MindroomAiRunInfo;
  open: boolean;
  onClose: () => void;
  returnFocusRef: React.RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const modelLabel = getMindroomAiRunModelLabel(info);
  const usageLabel = getMindroomAiRunUsageLabel(info, t, language);
  const usageCacheLabel = getMindroomAiRunUsageCacheLabel(info, t, language);
  const contextLabel = getMindroomAiRunContextLabel(info, t, language);
  const contextCacheLabel = getMindroomAiRunContextCacheLabel(info, t, language);
  const toolsLabel = formatMindroomAiRunNumber(info.toolCount, language);
  const ttftLabel = formatMindroomAiRunTimeToFirstToken(info.timeToFirstToken);

  return (
    <Overlay open={open} backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            setReturnFocus: () => returnFocusRef.current ?? false,
            onDeactivate: onClose,
            clickOutsideDeactivates: true,
            escapeDeactivates: stopPropagation,
          }}
        >
          <Dialog variant="Surface">
            <Header
              style={{
                padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
                borderBottomWidth: config.borderWidth.B300,
              }}
              variant="Surface"
              size="500"
            >
              <Box grow="Yes">
                <Text size="H4">
                  {t('mindroomUi.messages.mindroomMessageControls.aiRunMetadata')}
                </Text>
              </Box>
              <IconButton
                size="300"
                onClick={onClose}
                radii="300"
                aria-label={t('mindroomUi.messages.mindroomMessageControls.close')}
              >
                <Icon src={Icons.Cross} />
              </IconButton>
            </Header>
            <Box
              style={{ padding: config.space.S400, maxWidth: '24rem' }}
              direction="Column"
              gap="100"
            >
              <MindroomAiRunDetail
                label={t('mindroomUi.messages.mindroomMessageControls.status')}
                value={info.status}
              />
              <MindroomAiRunDetail
                label={t('mindroomUi.messages.mindroomMessageControls.model')}
                value={modelLabel}
              />
              <MindroomAiRunDetail
                label={t('mindroomUi.messages.mindroomMessageControls.tokens')}
                value={usageLabel}
              />
              <MindroomAiRunDetail
                label={t('mindroomUi.messages.mindroomMessageControls.runCache')}
                value={usageCacheLabel}
              />
              <MindroomAiRunDetail
                label={t('mindroomUi.messages.mindroomMessageControls.requestContext')}
                value={contextLabel}
              />
              <MindroomAiRunContextBar info={info} />
              <MindroomAiRunDetail
                label={t('mindroomUi.messages.mindroomMessageControls.requestCache')}
                value={contextCacheLabel}
              />
              <MindroomAiRunDetail
                label={t('mindroomUi.messages.mindroomMessageControls.tools')}
                value={toolsLabel}
              />
              <MindroomAiRunDetail
                label={t('mindroomUi.messages.mindroomMessageControls.ttft')}
                value={ttftLabel}
              />
              <MindroomAiRunDetail
                label={t('mindroomUi.messages.mindroomMessageControls.run')}
                value={info.runId}
              />
              <MindroomAiRunDetail
                label={t('mindroomUi.messages.mindroomMessageControls.session')}
                value={info.sessionId}
              />
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

export function MindroomAiRunInfoButton({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={css.AiRunInfoButton}
      aria-label={t('mindroomUi.messages.mindroomMessageControls.openAiRunMetadata')}
      aria-haspopup="dialog"
      aria-pressed={open}
      onClick={onOpen}
    >
      <Icon size="50" src={Icons.Info} />
    </button>
  );
}

export const MindroomAiRunMenuItem = as<
  'button',
  {
    onOpen: () => void;
  }
>(({ onOpen, ...props }, ref) => {
  const { t } = useTranslation();
  return (
    <MenuItem
      size="300"
      after={<Icon size="100" src={Icons.Info} />}
      radii="300"
      onClick={onOpen}
      aria-haspopup="dialog"
      {...props}
      ref={ref}
    >
      <Text className={css.MenuItemText} as="span" size="T300" truncate>
        {t('mindroomUi.messages.mindroomMessageControls.tokenUsage')}
      </Text>
    </MenuItem>
  );
});

export type MindroomAiRunControlsRenderProps = {
  dialog: ReactNode;
  messageBaseRef: React.Ref<HTMLDivElement>;
  onOpen: () => void;
  open: boolean;
};

export function MindroomAiRunControls({
  info,
  forwardedRef,
  children,
}: {
  info: MindroomAiRunInfo;
  forwardedRef: React.Ref<HTMLDivElement> | undefined;
  children: (props: MindroomAiRunControlsRenderProps) => ReactNode;
}) {
  const messageBaseRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  const handleMessageBaseRef = useCallback(
    (node: HTMLDivElement | null) => {
      messageBaseRef.current = node;
      assignElementRef(forwardedRef, node);
    },
    [forwardedRef]
  );

  return children({
    dialog: (
      <MindroomAiRunInfoDialog
        info={info}
        open={open}
        onClose={() => setOpen(false)}
        returnFocusRef={messageBaseRef}
      />
    ),
    messageBaseRef: handleMessageBaseRef,
    onOpen: () => setOpen(true),
    open,
  });
}

export const MindroomDownloadOriginalMenuItem = as<
  'button',
  {
    source: MindroomLongTextSource;
    onClose?: () => void;
  }
>(({ source, onClose, ...props }, ref) => {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const downloadedFileRef = useRef<{ identity: string; blob: Blob }>();
  const downloadInProgressRef = useRef(false);

  const [downloadState, download] = useAsyncCallback(
    useCallback(async () => {
      const identity = getMindroomLongTextSourceIdentity(source);
      let blob = downloadedFileRef.current?.identity === identity && downloadedFileRef.current.blob;
      if (!blob) {
        blob = await downloadMindroomLongTextSidecarBlob(mx, source, useAuthentication, true);
        downloadedFileRef.current = { identity, blob };
      }
      const saved = await saveFile(blob, getMindroomLongTextDownloadName(source));
      if (saved) onClose?.();
    }, [mx, source, useAuthentication, onClose])
  );
  const handleDownload = () => {
    if (downloadState.status === AsyncStatus.Loading || downloadInProgressRef.current) return;
    downloadInProgressRef.current = true;
    void download()
      .catch(() => undefined)
      .finally(() => {
        downloadInProgressRef.current = false;
      });
  };

  return (
    <MenuItem
      size="300"
      after={
        downloadState.status === AsyncStatus.Loading ? (
          <Spinner fill="Soft" size="100" />
        ) : (
          <Icon
            size="100"
            src={downloadState.status === AsyncStatus.Error ? Icons.Warning : Icons.Download}
          />
        )
      }
      radii="300"
      onClick={handleDownload}
      disabled={downloadState.status === AsyncStatus.Loading}
      aria-disabled={downloadState.status === AsyncStatus.Loading}
      {...props}
      ref={ref}
    >
      <Text className={css.MenuItemText} as="span" size="T300" truncate>
        {downloadState.status === AsyncStatus.Loading
          ? t('mindroomUi.messages.mindroomMessageControls.downloadingOriginal')
          : downloadState.status === AsyncStatus.Error
          ? t('mindroomUi.messages.mindroomMessageControls.retryDownloadOriginal')
          : t('mindroomUi.messages.mindroomMessageControls.downloadOriginal')}
      </Text>
    </MenuItem>
  );
});
