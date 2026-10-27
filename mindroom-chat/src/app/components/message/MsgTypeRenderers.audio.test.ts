import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { MsgType } from 'matrix-js-sdk';
import {
  MATRIX_AUDIO_DETAILS_PROPERTY_NAME,
  MATRIX_VOICE_MESSAGE_PROPERTY_NAME,
} from '../../../types/matrix/common';
import { MAudio } from './MsgTypeRenderers';

vi.mock('folds', () => {
  const Wrapper = ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('div', props, children);

  return {
    Box: Wrapper,
    Chip: Wrapper,
    Icon: (props: Record<string, unknown>) => React.createElement('span', props),
    Icons: {},
    Text: Wrapper,
    toRem: (value: number) => `${value}px`,
  };
});

vi.mock('./content', () => ({
  BrokenContent: () => React.createElement('div', { 'data-renderer': 'broken' }),
  MessageBadEncryptedContent: () => null,
  MessageBrokenContent: () => null,
  MessageDeletedContent: () => null,
  MessageEditedContent: () => null,
  MessageUnsupportedContent: () => null,
}));

vi.mock('./content/VoiceAudioContent', () => ({
  VoiceAudioContent: (props: Record<string, unknown>) =>
    React.createElement('div', { 'data-renderer': 'voice-audio', ...props }),
}));

vi.mock('./attachment', () => {
  const Wrapper = ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('div', props, children);

  return {
    Attachment: Wrapper,
    AttachmentBox: Wrapper,
    AttachmentContent: Wrapper,
    AttachmentHeader: Wrapper,
  };
});

vi.mock('./FileRow.css', () => ({
  FileRow: 'FileRow',
  FileTile: 'FileTile',
  FileInfo: 'FileInfo',
  FileName: 'FileName',
}));

vi.mock('./FileHeader', () => ({
  FileDownloadButton: () => React.createElement('button', { 'aria-label': 'Download file' }),
  FileHeader: ({ after, body }: { after?: React.ReactNode; body: string }) =>
    React.createElement('div', { 'data-file-header': body }, after),
}));

vi.mock('./Time', () => ({
  Time: () => null,
}));

vi.mock('./layout', () => ({
  MessageTextBody: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../streaming-indicator/StreamingIndicator', () => ({
  StreamingIndicator: () => null,
}));

vi.mock('../../state/hooks/settings', () => ({
  useSetting: () => [false],
}));

vi.mock('../../state/settings', () => ({
  settingsAtom: {},
}));

vi.mock('./mindroomThreadSummary', () => ({
  formatMindroomThreadSummaryMessageCount: () => '',
}));

vi.mock('./mindroomThreadSummaryCard.css', () => ({
  ThreadSummaryBody: 'ThreadSummaryBody',
  ThreadSummaryBodyCompact: 'ThreadSummaryBodyCompact',
  ThreadSummaryCard: 'ThreadSummaryCard',
  ThreadSummaryLabel: 'ThreadSummaryLabel',
  ThreadSummaryMeta: 'ThreadSummaryMeta',
}));

describe('MAudio voice branch', () => {
  it('renders compact VoiceAudioContent for voice m.audio', () => {
    const renderer = create(
      React.createElement(MAudio, {
        content: {
          msgtype: MsgType.Audio,
          body: 'voice.ogg',
          url: 'mxc://mindroom/voice',
          info: {
            mimetype: 'audio/ogg',
            duration: 5000,
          },
          [MATRIX_VOICE_MESSAGE_PROPERTY_NAME]: {},
          [MATRIX_AUDIO_DETAILS_PROPERTY_NAME]: {
            duration: 5000,
            waveform: [0, 512, 1024],
          },
        },
        renderAsFile: () => React.createElement('div', { 'data-renderer': 'file' }),
      })
    );

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain('voice-audio');
    expect(rendered).not.toContain('Download file');

    renderer.unmount();
  });

  it('renders non-voice m.audio with the canonical voice-style audio UI', () => {
    const renderer = create(
      React.createElement(MAudio, {
        content: {
          msgtype: MsgType.Audio,
          body: 'clip.ogg',
          filename: 'clip.ogg',
          url: 'mxc://mindroom/audio',
          info: {
            mimetype: 'audio/ogg',
            duration: 5000,
          },
        },
        renderAsFile: () => React.createElement('div', { 'data-renderer': 'file' }),
      })
    );

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain('voice-audio');
    expect(rendered).toContain('clip.ogg');
    expect(rendered).not.toContain('Download file');

    renderer.unmount();
  });
});
