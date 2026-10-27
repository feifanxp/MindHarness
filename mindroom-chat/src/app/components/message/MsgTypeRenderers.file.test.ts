import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { MsgType } from 'matrix-js-sdk';
import { MAudio, MFile, MImage, MVideo } from './MsgTypeRenderers';
import { FileContent, ReadTextFile } from './content/FileContent';
import { FileDownloadButton } from './FileHeader';

vi.mock('./content', () => ({
  BrokenContent: () => React.createElement('div', { 'data-renderer': 'broken' }),
  MessageBadEncryptedContent: () => null,
  MessageBrokenContent: () => null,
  MessageDeletedContent: () => null,
  MessageEditedContent: () => null,
  MessageUnsupportedContent: () => null,
}));

// Renders the file name as text, as the real player does.
vi.mock('./content/VoiceAudioContent', () => ({
  VoiceAudioContent: ({ filename }: { filename: string }) =>
    React.createElement('div', null, filename),
}));

vi.mock('./attachment', () => {
  const Wrapper = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children);

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

vi.mock('../glass/GlassPrimitives', () => ({ Modal: () => null }));
vi.mock('../../styles/Modal.css', () => ({ ModalWide: 'modal-wide' }));
vi.mock('./layout', () => ({ MessageTextBody: () => null }));
vi.mock('../../hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));
vi.mock('../../hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));

describe('file renderers', () => {
  it('render events whose file name or MIME type is not a string', () => {
    // Event content is arbitrary JSON from the sender.
    const fields = { body: 5, filename: { name: 'x' }, url: 'mxc://example.org/file' };
    const renderText = (element: React.ReactElement) => {
      const renderer = create(element);
      const text = JSON.stringify(renderer.toJSON());
      renderer.unmount();
      return text;
    };

    const file = renderText(
      React.createElement(MFile, {
        content: { ...fields, msgtype: MsgType.File, info: { mimetype: 5 } } as never,
        renderFileContent: ({ body, mimeType }) =>
          React.createElement(FileContent, {
            body,
            mimeType,
            renderAsTextFile: () => null,
            renderAsPdfFile: () => null,
          }),
      })
    );
    expect(file).toContain('Unnamed File');
    expect(file).toContain('"File"');

    const video = renderText(
      React.createElement(MVideo, {
        content: { ...fields, msgtype: MsgType.Video, info: { mimetype: 'video/mp4' } } as never,
        renderAsFile: () => null,
        renderVideoContent: () => null,
      })
    );
    expect(video).toContain('Video');

    const audio = renderText(
      React.createElement(MAudio, {
        content: { ...fields, msgtype: MsgType.Audio, info: { mimetype: 'audio/ogg' } } as never,
        renderAsFile: () => null,
      })
    );
    expect(audio).toContain('Audio');
  });
});

describe('MFile', () => {
  it('shows a text file as one row with its type, size, and Open and Download buttons', () => {
    const renderer = create(
      React.createElement(MFile, {
        content: {
          msgtype: MsgType.File,
          body: 'release-notes.txt',
          url: 'mxc://example.org/notes',
          info: { mimetype: 'text/plain', size: 2400 },
        } as never,
        renderFileContent: ({ body, mimeType, url, encInfo }) =>
          React.createElement(
            FileContent,
            {
              body,
              mimeType,
              renderAsTextFile: () =>
                React.createElement(ReadTextFile, {
                  body,
                  mimeType,
                  url,
                  encInfo,
                  iconOnly: true,
                  renderViewer: () => null,
                }),
              renderAsPdfFile: () => null,
            },
            React.createElement(FileDownloadButton, { filename: body, url, mimeType, encInfo })
          ),
      })
    );
    const text = JSON.stringify(renderer.toJSON());
    expect(text).toContain('release-notes.txt');
    expect(text).toContain('Text file · 2.4 KB');
    expect(text).toContain('"TXT"');
    expect(
      renderer.root.findAllByType('button').map((button) => button.props['aria-label'])
    ).toEqual(['Open release-notes.txt', 'Download release-notes.txt']);
    renderer.unmount();
  });
});

describe('MImage', () => {
  it.each([
    ['image/svg+xml', 'file'],
    ['image/png', 'image'],
  ])('renders an image declared as %s as %s content', (mimetype, renderedAs) => {
    const renderer = create(
      React.createElement(MImage, {
        content: {
          msgtype: MsgType.Image,
          body: 'diagram',
          url: 'mxc://example.org/diagram',
          info: { mimetype },
        },
        renderAsFile: () => React.createElement('div', { 'data-renderer': 'file' }),
        renderImageContent: () => React.createElement('div', { 'data-renderer': 'image' }),
      })
    );

    expect(JSON.stringify(renderer.toJSON())).toContain(`"data-renderer":"${renderedAs}"`);

    renderer.unmount();
  });
});
