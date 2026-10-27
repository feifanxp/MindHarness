import { useTranslation } from 'react-i18next';
import React, { CSSProperties, ReactNode } from 'react';
import { Box, Chip, Icon, Icons, Text, toRem } from 'folds';
import { IContent } from 'matrix-js-sdk';
import type { EventAttachmentOwner } from '../../mindroom/messages/eventAttachments';
import { JUMBO_EMOJI_REG, URL_REG } from '../../utils/regex';
import { trimReplyFromBody } from '../../utils/room';
import { MessageTextBody } from './layout';
import {
  MessageBadEncryptedContent,
  MessageBrokenContent,
  MessageDeletedContent,
  MessageEditedContent,
  MessageUnsupportedContent,
} from './content';
import { VoiceAudioContent } from './content/VoiceAudioContent';
import {
  IAudioContent,
  IAudioInfo,
  IEncryptedFile,
  IFileContent,
  IFileInfo,
  IImageContent,
  IImageInfo,
  IThumbnailContent,
  IVideoContent,
  IVideoInfo,
  MATRIX_SPOILER_PROPERTY_NAME,
  MATRIX_SPOILER_REASON_PROPERTY_NAME,
} from '../../../types/matrix/common';
import {
  FALLBACK_MIMETYPE,
  READABLE_EXT_TO_MIME_TYPE,
  READABLE_TEXT_MIME_TYPES,
  getBlobSafeMimeType,
  getFileNameExt,
  mimeTypeToExt,
} from '../../utils/mimeTypes';
import { bytesToSize, parseGeoUri, scaleYDimension } from '../../utils/common';
import { getVoiceMessageAudioDetails, isVoiceMessageContent } from '../../utils/voiceMessage';
import { Attachment, AttachmentBox, AttachmentHeader } from './attachment';
import { FileHeader, FileDownloadButton } from './FileHeader';
import * as fileRowCss from './FileRow.css';

export function MBadEncrypted() {
  return (
    <Text>
      <MessageBadEncryptedContent />
    </Text>
  );
}

type RedactedContentProps = {
  reason?: string;
};
export function RedactedContent({ reason }: RedactedContentProps) {
  return (
    <Text>
      <MessageDeletedContent reason={reason} />
    </Text>
  );
}

export function UnsupportedContent() {
  return (
    <Text>
      <MessageUnsupportedContent />
    </Text>
  );
}

export function BrokenContent() {
  return (
    <Text>
      <MessageBrokenContent />
    </Text>
  );
}

type RenderBodyProps = {
  body: string;
  customBody?: string;
};
type RenderMessageStateProps = {
  edited?: boolean;
  renderStateSuffix?: () => ReactNode;
};
const renderMessageStateSuffix = ({ edited, renderStateSuffix }: RenderMessageStateProps) =>
  renderStateSuffix ? renderStateSuffix() : edited && <MessageEditedContent />;

type MTextProps = {
  edited?: boolean;
  renderStateSuffix?: () => ReactNode;
  content: Record<string, unknown>;
  renderBody: (props: RenderBodyProps) => ReactNode;
  renderAfterBody?: ReactNode;
  renderUrlsPreview?: (urls: string[]) => ReactNode;
  style?: CSSProperties;
};
export function MText({
  edited,
  renderStateSuffix,
  content,
  renderBody,
  renderAfterBody,
  renderUrlsPreview,
  style,
}: MTextProps) {
  const { body, formatted_body: customBody } = content;

  if (typeof body !== 'string') return <BrokenContent />;
  const trimmedBody = trimReplyFromBody(body);
  const urlsMatch = renderUrlsPreview && trimmedBody.match(URL_REG);
  const urls = urlsMatch ? [...new Set(urlsMatch)] : undefined;

  return (
    <>
      <MessageTextBody
        preWrap={typeof customBody !== 'string'}
        jumboEmoji={JUMBO_EMOJI_REG.test(trimmedBody)}
        style={style}
      >
        {renderBody({
          body: trimmedBody,
          customBody: typeof customBody === 'string' ? customBody : undefined,
        })}
        {renderMessageStateSuffix({ edited, renderStateSuffix })}
      </MessageTextBody>
      {renderAfterBody}
      {renderUrlsPreview && urls && urls.length > 0 && renderUrlsPreview(urls)}
    </>
  );
}

type MEmoteProps = {
  displayName: string;
  edited?: boolean;
  renderStateSuffix?: () => ReactNode;
  content: Record<string, unknown>;
  renderBody: (props: RenderBodyProps) => ReactNode;
  renderAfterBody?: ReactNode;
  renderUrlsPreview?: (urls: string[]) => ReactNode;
};
export function MEmote({
  displayName,
  edited,
  renderStateSuffix,
  content,
  renderBody,
  renderAfterBody,
  renderUrlsPreview,
}: MEmoteProps) {
  const { body, formatted_body: customBody } = content;

  if (typeof body !== 'string') return <BrokenContent />;
  const trimmedBody = trimReplyFromBody(body);
  const urlsMatch = renderUrlsPreview && trimmedBody.match(URL_REG);
  const urls = urlsMatch ? [...new Set(urlsMatch)] : undefined;

  return (
    <>
      <MessageTextBody
        emote
        preWrap={typeof customBody !== 'string'}
        jumboEmoji={JUMBO_EMOJI_REG.test(trimmedBody)}
      >
        <b>{`${displayName} `}</b>
        {renderBody({
          body: trimmedBody,
          customBody: typeof customBody === 'string' ? customBody : undefined,
        })}
        {renderMessageStateSuffix({ edited, renderStateSuffix })}
      </MessageTextBody>
      {renderAfterBody}
      {renderUrlsPreview && urls && urls.length > 0 && renderUrlsPreview(urls)}
    </>
  );
}

type MNoticeProps = {
  edited?: boolean;
  renderStateSuffix?: () => ReactNode;
  content: Record<string, unknown>;
  renderBody: (props: RenderBodyProps) => ReactNode;
  renderAfterBody?: ReactNode;
  renderUrlsPreview?: (urls: string[]) => ReactNode;
};
export function MNotice({
  edited,
  renderStateSuffix,
  content,
  renderBody,
  renderAfterBody,
  renderUrlsPreview,
}: MNoticeProps) {
  const { body, formatted_body: customBody } = content;

  if (typeof body !== 'string') return <BrokenContent />;
  const trimmedBody = trimReplyFromBody(body);
  const urlsMatch = renderUrlsPreview && trimmedBody.match(URL_REG);
  const urls = urlsMatch ? [...new Set(urlsMatch)] : undefined;

  return (
    <>
      <MessageTextBody
        notice
        preWrap={typeof customBody !== 'string'}
        jumboEmoji={JUMBO_EMOJI_REG.test(trimmedBody)}
      >
        {renderBody({
          body: trimmedBody,
          customBody: typeof customBody === 'string' ? customBody : undefined,
        })}
        {renderMessageStateSuffix({ edited, renderStateSuffix })}
      </MessageTextBody>
      {renderAfterBody}
      {renderUrlsPreview && urls && urls.length > 0 && renderUrlsPreview(urls)}
    </>
  );
}

type RenderImageContentProps = {
  body: string;
  filename?: string;
  info?: IImageInfo & IThumbnailContent;
  mimeType?: string;
  url: string;
  encInfo?: IEncryptedFile;
  markedAsSpoiler?: boolean;
  spoilerReason?: string;
};
type MImageProps = {
  content: IImageContent;
  renderAsFile: () => ReactNode;
  renderImageContent: (props: RenderImageContentProps) => ReactNode;
  outlined?: boolean;
};
export function MImage({ content, renderAsFile, renderImageContent, outlined }: MImageProps) {
  const imgInfo = content?.info;
  const mxcUrl = content.file?.url ?? content.url;
  if (typeof mxcUrl !== 'string') {
    return <BrokenContent />;
  }
  // Image blobs never carry the SVG type, so an SVG cannot render inline; offer it as a file.
  if (imgInfo?.mimetype === 'image/svg+xml') {
    return renderAsFile();
  }
  const height = scaleYDimension(imgInfo?.w || 400, 400, imgInfo?.h || 400);

  return (
    <Attachment outlined={outlined}>
      <AttachmentBox
        style={{
          height: toRem(height < 48 ? 48 : height),
        }}
      >
        {renderImageContent({
          body: content.body || 'Image',
          info: imgInfo,
          mimeType: imgInfo?.mimetype,
          url: mxcUrl,
          encInfo: content.file,
          markedAsSpoiler: content[MATRIX_SPOILER_PROPERTY_NAME],
          spoilerReason: content[MATRIX_SPOILER_REASON_PROPERTY_NAME],
        })}
      </AttachmentBox>
    </Attachment>
  );
}

// Event content is untrusted JSON: a name that is not a string crashes the render.
const getFileName = (content: { filename?: unknown; body?: unknown }): string | undefined =>
  [content.filename, content.body].find((name): name is string => typeof name === 'string');

type RenderVideoContentProps = {
  body: string;
  info: IVideoInfo & IThumbnailContent;
  mimeType: string;
  url: string;
  encInfo?: IEncryptedFile;
  markedAsSpoiler?: boolean;
  spoilerReason?: string;
};
type MVideoProps = {
  owner?: EventAttachmentOwner;
  content: IVideoContent;
  renderAsFile: () => ReactNode;
  renderVideoContent: (props: RenderVideoContentProps) => ReactNode;
  outlined?: boolean;
};
export function MVideo({
  owner,
  content,
  renderAsFile,
  renderVideoContent,
  outlined,
}: MVideoProps) {
  const videoInfo = content?.info;
  const mxcUrl = content.file?.url ?? content.url;
  const safeMimeType = getBlobSafeMimeType(videoInfo?.mimetype ?? '');

  if (!videoInfo || !safeMimeType.startsWith('video') || typeof mxcUrl !== 'string') {
    if (mxcUrl) {
      return renderAsFile();
    }
    return <BrokenContent />;
  }

  const height = scaleYDimension(videoInfo.w || 400, 400, videoInfo.h || 400);

  const filename = getFileName(content) ?? 'Video';

  return (
    <Attachment outlined={outlined}>
      <AttachmentHeader>
        <FileHeader
          body={filename}
          mimeType={safeMimeType}
          after={
            <FileDownloadButton
              owner={owner}
              filename={filename}
              url={mxcUrl}
              mimeType={safeMimeType}
              encInfo={content.file}
            />
          }
        />
      </AttachmentHeader>
      <AttachmentBox
        style={{
          height: toRem(height < 48 ? 48 : height),
        }}
      >
        {renderVideoContent({
          body: content.body || 'Video',
          info: videoInfo,
          mimeType: safeMimeType,
          url: mxcUrl,
          encInfo: content.file,
          markedAsSpoiler: content[MATRIX_SPOILER_PROPERTY_NAME],
          spoilerReason: content[MATRIX_SPOILER_REASON_PROPERTY_NAME],
        })}
      </AttachmentBox>
    </Attachment>
  );
}

type MAudioProps = {
  owner?: EventAttachmentOwner;
  content: IAudioContent;
  renderAsFile: () => ReactNode;
  outlined?: boolean;
};
export function MAudio({ owner, content, renderAsFile }: MAudioProps) {
  const { t } = useTranslation();
  const voiceMessage = isVoiceMessageContent(content as Record<string, unknown>);
  const voiceAudioDetails = getVoiceMessageAudioDetails(content as Record<string, unknown>);
  const audioInfo: IAudioInfo | undefined =
    content?.info || voiceAudioDetails
      ? {
          ...(content?.info ?? {}),
          ...(content?.info?.duration === undefined && voiceAudioDetails?.duration !== undefined
            ? { duration: voiceAudioDetails.duration }
            : {}),
        }
      : undefined;
  const mxcUrl = content.file?.url ?? content.url;
  const safeMimeType = getBlobSafeMimeType(audioInfo?.mimetype ?? '');

  if (!audioInfo || !safeMimeType.startsWith('audio') || typeof mxcUrl !== 'string') {
    if (mxcUrl) {
      return renderAsFile();
    }
    return <BrokenContent />;
  }

  const downloadFilename = getFileName(content) ?? 'Audio';
  return (
    <VoiceAudioContent
      owner={owner}
      info={audioInfo}
      mimeType={safeMimeType}
      url={mxcUrl}
      encInfo={content.file}
      filename={downloadFilename}
      waveform={voiceAudioDetails?.waveform}
      isVoiceMessage={voiceMessage}
      label={
        voiceMessage
          ? t('sharedUi.msgTypeRenderers.voiceMessage')
          : t('sharedUi.msgTypeRenderers.audio')
      }
    />
  );
}

type RenderFileContentProps = {
  body: string;
  info: IFileInfo & IThumbnailContent;
  mimeType: string;
  url: string;
  encInfo?: IEncryptedFile;
};
type MFileProps = {
  content: IFileContent;
  renderFileContent: (props: RenderFileContentProps) => ReactNode;
  outlined?: boolean;
};
export function MFile({ content, renderFileContent, outlined }: MFileProps) {
  const { t } = useTranslation();
  const fileInfo = content?.info;
  const mxcUrl = content.file?.url ?? content.url;

  if (typeof mxcUrl !== 'string') {
    return <BrokenContent />;
  }

  const fileName = getFileName(content);
  const mimeType = typeof fileInfo?.mimetype === 'string' ? fileInfo.mimetype : FALLBACK_MIMETYPE;
  const name = fileName ?? t('sharedUi.msgTypeRenderers.unnamedFile');
  const ext = (
    fileName?.includes('.') ? getFileNameExt(fileName) : mimeTypeToExt(mimeType)
  ).toUpperCase();
  const type =
    READABLE_TEXT_MIME_TYPES.includes(mimeType) || READABLE_EXT_TO_MIME_TYPE[getFileNameExt(name)]
      ? t('sharedUi.msgTypeRenderers.textFile')
      : mimeType === 'application/pdf'
      ? t('sharedUi.msgTypeRenderers.pdfDocument')
      : t('sharedUi.msgTypeRenderers.file');
  const size = typeof fileInfo?.size === 'number' ? bytesToSize(fileInfo.size) : undefined;

  return (
    <Attachment outlined={outlined}>
      <div className={fileRowCss.FileRow}>
        <span className={fileRowCss.FileTile} aria-hidden>
          {ext && ext.length <= 4 ? ext : <Icon size="100" src={Icons.File} />}
        </span>
        <div className={fileRowCss.FileInfo}>
          <Text size="T300" truncate className={fileRowCss.FileName}>
            {name}
          </Text>
          <Text size="T200" priority="300" truncate>
            {size ? t('sharedUi.msgTypeRenderers.fileMeta', { type, size }) : type}
          </Text>
        </div>
        {renderFileContent({
          body: fileName ?? t('mindroomUi.message-search.searchResultPreview.file'),
          info: fileInfo ?? {},
          mimeType,
          url: mxcUrl,
          encInfo: content.file,
        })}
      </div>
    </Attachment>
  );
}

type MLocationProps = {
  content: IContent;
};
export function MLocation({ content }: MLocationProps) {
  const { t } = useTranslation();
  const geoUri = content.geo_uri;
  if (typeof geoUri !== 'string') return <BrokenContent />;
  const location = parseGeoUri(geoUri);
  if (!location) return <BrokenContent />;

  return (
    <Box direction="Column" alignItems="Start" gap="100">
      <Text size="T400">{geoUri}</Text>
      <Chip
        as="a"
        size="400"
        href={`https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=16/${location.latitude}/${location.longitude}`}
        target="_blank"
        rel="noreferrer noopener"
        variant="Primary"
        radii="Pill"
        before={<Icon src={Icons.External} size="50" />}
      >
        <Text size="B300">{t('sharedUi.msgTypeRenderers.openLocation')}</Text>
      </Chip>
    </Box>
  );
}

type MStickerProps = {
  content: IImageContent;
  renderImageContent: (props: RenderImageContentProps) => ReactNode;
};
export function MSticker({ content, renderImageContent }: MStickerProps) {
  const imgInfo = content?.info;
  const mxcUrl = content.file?.url ?? content.url;
  if (typeof mxcUrl !== 'string') {
    return <MessageBrokenContent />;
  }
  const height = scaleYDimension(imgInfo?.w || 152, 152, imgInfo?.h || 152);

  return (
    <AttachmentBox
      style={{
        height: toRem(height < 48 ? 48 : height),
        width: toRem(152),
      }}
    >
      {renderImageContent({
        body: content.body || 'Sticker',
        info: imgInfo,
        mimeType: imgInfo?.mimetype,
        url: mxcUrl,
        encInfo: content.file,
      })}
    </AttachmentBox>
  );
}
