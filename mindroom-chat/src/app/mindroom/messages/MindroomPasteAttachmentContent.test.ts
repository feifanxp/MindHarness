import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { MindroomPasteAttachmentContent } from './MindroomPasteAttachmentContent';

vi.mock('folds', () => ({
  Box: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('span', null, children),
}));

vi.mock('../../components/message', () => ({
  Attachment: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
  AttachmentBox: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
  AttachmentContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
  AttachmentHeader: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
  DownloadFile: ({ buttonText = 'Download (1.2 MB)' }: { buttonText?: string }) =>
    React.createElement('button', null, buttonText),
  FileContent: ({
    children,
    renderAsTextFile,
  }: {
    children?: React.ReactNode;
    renderAsTextFile: () => React.ReactNode;
  }) => React.createElement('div', null, renderAsTextFile(), children),
  FileHeader: ({
    after,
    body,
    mimeType,
  }: {
    after?: React.ReactNode;
    body: string;
    mimeType: string;
  }) => React.createElement('div', null, mimeType, body, after),
  ReadTextFile: ({ buttonText = 'Open File' }: { buttonText?: string }) =>
    React.createElement('button', null, buttonText),
}));

vi.mock('../../components/text-viewer', () => ({
  TextViewer: () => React.createElement('div'),
}));

vi.mock('./MindroomPasteAttachmentContent.css.ts', () => ({
  Actions: 'Actions',
  Card: 'Card',
  Details: 'Details',
  FileName: 'FileName',
  Header: 'Header',
  Meta: 'Meta',
  Outlined: 'Outlined',
  Title: 'Title',
}));

describe('MindroomPasteAttachmentContent', () => {
  it('renders compact action labels for pasted text attachments', () => {
    const renderer = create(
      React.createElement(MindroomPasteAttachmentContent, {
        attachment: {
          id: 'paste-b47409',
          chars: 1224043,
          fileName: 'mindroom-paste-b47409.txt',
          mxcUri: 'mxc://mindroom.chat/0cV6QwCeY0wHgfRdXhbNPPPPnofmcfe0',
          mimeType: 'text/plain',
          size: 1224043,
        },
      })
    );

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('Pasted text');
    expect(rendered).toContain('1,224,043 characters');
    expect(rendered).toContain('mindroom-paste-b47409.txt');
    expect(rendered).toContain('Open');
    expect(rendered).toContain('Download');
    expect(rendered).not.toContain('Open pasted text');
    expect(rendered).not.toContain('Download (1.2 MB)');

    renderer.unmount();
  });
});
