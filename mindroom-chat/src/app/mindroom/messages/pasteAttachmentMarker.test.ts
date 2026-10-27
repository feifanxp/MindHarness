import { describe, expect, it, vi } from 'vitest';
import {
  MINDROOM_PASTE_ATTACHMENT_CONTENT_KEY,
  createMindroomPasteAttachment,
  createMindroomPasteId,
  formatMindroomPasteMarkerTextAsHtml,
  getMindroomPasteAttachmentFile,
  parseMindroomPasteMarker,
  withMindroomPasteAttachmentMetadata,
} from './pasteAttachmentMarker';

describe('pasteAttachmentMarker', () => {
  it('creates a text attachment with a parseable marker', async () => {
    const created = createMindroomPasteAttachment('hello world', { id: 'paste-a3f19c' });

    expect(created.id).toBe('paste-a3f19c');
    expect(created.file.name).toBe('mindroom-paste-a3f19c.txt');
    expect(created.file.type).toBe('text/plain;charset=utf-8');
    expect(await created.file.text()).toBe('hello world');
    expect(created.marker).toBe(
      '[[mindroom-paste:{"v":1,"id":"paste-a3f19c","chars":11,"file":"mindroom-paste-a3f19c.txt"}]]'
    );
    expect(parseMindroomPasteMarker(created.marker)).toEqual({
      id: 'paste-a3f19c',
      chars: 11,
      fileName: 'mindroom-paste-a3f19c.txt',
      raw: created.marker,
    });
  });

  it('creates short lowercase hex ids', () => {
    expect(createMindroomPasteId(() => new Uint8Array([0xa3, 0xf1, 0x9c]))).toBe('paste-a3f19c');
  });

  it('rejects malformed markers', () => {
    expect(parseMindroomPasteMarker('[[mindroom-paste id=bad chars=11 file="x.txt"]]')).toBe(
      undefined
    );
    expect(
      parseMindroomPasteMarker(
        '[[mindroom-paste:{"v":1,"id":"paste-a3f19c","chars":"NaN","file":"x.txt"}]]'
      )
    ).toBe(undefined);
    expect(
      parseMindroomPasteMarker(
        '[[mindroom-paste:{"v":1,"id":"paste-a3f19c","chars":11,"file":"../x.txt"}]]'
      )
    ).toBe(undefined);
  });

  it('formats inline markers as safe HTML spans', () => {
    const html = formatMindroomPasteMarkerTextAsHtml(
      'Before <unsafe> [[mindroom-paste:{"v":1,"id":"paste-a3f19c","chars":11,"file":"mindroom-paste-a3f19c.txt"}]] after'
    );

    expect(html).toBe(
      [
        '<p>Before &lt;unsafe&gt; ',
        '<span data-mindroom-paste-marker="true" data-mindroom-paste-id="paste-a3f19c" data-mindroom-paste-chars="11" data-mindroom-paste-file="mindroom-paste-a3f19c.txt">',
        '[[mindroom-paste:{&quot;v&quot;:1,&quot;id&quot;:&quot;paste-a3f19c&quot;,&quot;chars&quot;:11,&quot;file&quot;:&quot;mindroom-paste-a3f19c.txt&quot;}]]',
        '</span>',
        ' after</p>',
      ].join('')
    );
  });

  it('returns undefined when text has no paste marker', () => {
    expect(formatMindroomPasteMarkerTextAsHtml('ordinary message')).toBeUndefined();
  });

  it('adds parseable metadata to generated paste file events', () => {
    const content = withMindroomPasteAttachmentMetadata(
      {
        msgtype: 'm.file',
        body: 'mindroom-paste-a3f19c.txt',
        filename: 'mindroom-paste-a3f19c.txt',
        url: 'mxc://example.org/pasted-text',
        info: {
          mimetype: 'text/plain',
          size: 11,
        },
      },
      {
        id: 'paste-a3f19c',
        chars: 11,
        fileName: 'mindroom-paste-a3f19c.txt',
      }
    );

    expect(content[MINDROOM_PASTE_ATTACHMENT_CONTENT_KEY]).toEqual({
      version: 1,
      id: 'paste-a3f19c',
      chars: 11,
      file: 'mindroom-paste-a3f19c.txt',
    });
    expect(getMindroomPasteAttachmentFile(content)).toEqual({
      id: 'paste-a3f19c',
      chars: 11,
      fileName: 'mindroom-paste-a3f19c.txt',
      mxcUri: 'mxc://example.org/pasted-text',
      mimeType: 'text/plain',
      size: 11,
      encryptedFile: undefined,
    });
  });

  it('uses cryptographic random bytes when available', () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.set([0xde, 0xad, 0xbe]);
        return bytes;
      },
    });

    expect(createMindroomPasteId()).toBe('paste-deadbe');

    vi.stubGlobal('crypto', originalCrypto);
  });
});
