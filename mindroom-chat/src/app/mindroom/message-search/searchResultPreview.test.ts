import { MsgType, RelationType } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { MessageEvent } from '../../../types/matrix/room';
import {
  getSearchResultBodySnippet,
  getSearchResultEffectiveContent,
  getSearchResultLightweightCustomBody,
  getSearchResultLightweightFormattedBody,
  getSearchResultPreviewText,
  isSearchResultEdited,
  shouldUseLightweightSearchResultBody,
} from './searchResultPreview';

describe('getSearchResultPreviewText', () => {
  it('uses replacement content for edited search results', () => {
    expect(
      getSearchResultPreviewText({
        type: MessageEvent.RoomMessage,
        content: {
          body: 'old body',
          msgtype: MsgType.Text,
          'm.new_content': {
            body: 'new body',
            msgtype: MsgType.Text,
          },
          'm.relates_to': {
            rel_type: RelationType.Replace,
            event_id: '$target',
          },
        },
      } as never)
    ).toBe('new body');
  });

  it('labels media messages tersely', () => {
    expect(
      getSearchResultPreviewText({
        type: MessageEvent.RoomMessage,
        content: {
          body: 'report.pdf',
          msgtype: MsgType.File,
        },
      } as never)
    ).toBe('File: report.pdf');
  });

  it('returns a stable preview for redacted messages', () => {
    expect(
      getSearchResultPreviewText({
        type: MessageEvent.RoomMessage,
        content: {
          body: 'hello',
          msgtype: MsgType.Text,
        },
        unsigned: {
          redacted_because: {
            content: {},
          },
        },
      } as never)
    ).toBe('Message was redacted.');
  });

  it('uses bundled unsigned replacements for edited previews', () => {
    expect(
      getSearchResultPreviewText({
        type: MessageEvent.RoomMessage,
        content: {
          body: 'old body',
          msgtype: MsgType.Text,
        },
        unsigned: {
          'm.relations': {
            [RelationType.Replace]: {
              content: {
                body: 'wrapper body',
                msgtype: MsgType.Text,
                'm.new_content': {
                  body: 'final body',
                  msgtype: MsgType.Text,
                },
              },
            },
          },
        },
      } as never)
    ).toBe('final body');
  });

  it('marks bundled unsigned replacements as edited', () => {
    expect(
      isSearchResultEdited({
        type: MessageEvent.RoomMessage,
        content: {
          body: 'old body',
          msgtype: MsgType.Text,
        },
        unsigned: {
          'm.relations': {
            [RelationType.Replace]: {
              content: {
                body: 'wrapper body',
                msgtype: MsgType.Text,
                'm.new_content': {
                  body: 'final body',
                  msgtype: MsgType.Text,
                },
              },
            },
          },
        },
      } as never)
    ).toBe(true);
  });

  it('returns bundled unsigned replacement content for text renderers', () => {
    expect(
      getSearchResultEffectiveContent({
        type: MessageEvent.RoomMessage,
        content: {
          body: 'old body',
          msgtype: MsgType.Text,
        },
        unsigned: {
          'm.relations': {
            [RelationType.Replace]: {
              content: {
                body: 'wrapper body',
                msgtype: MsgType.Text,
                'm.new_content': {
                  body: 'final body',
                  msgtype: MsgType.Text,
                },
              },
            },
          },
        },
      } as never)
    ).toMatchObject({
      body: 'final body',
      msgtype: MsgType.Text,
    });
  });

  it('truncates oversized preview bodies', () => {
    const hugeBody = `prefix ${'x'.repeat(3000)} suffix`;

    expect(
      getSearchResultPreviewText({
        type: MessageEvent.RoomMessage,
        content: {
          body: hugeBody,
          msgtype: MsgType.File,
        },
      } as never)
    ).toMatch(/^File: /);
    expect(
      getSearchResultPreviewText({
        type: MessageEvent.RoomMessage,
        content: {
          body: hugeBody,
          msgtype: MsgType.File,
        },
      } as never).length
    ).toBeLessThan(1700);
  });

  it('centers oversized previews around the first highlight', () => {
    const hugeBody = `${'a'.repeat(2000)} CINNY-024 ${'b'.repeat(2000)}`;

    const preview = getSearchResultPreviewText(
      {
        type: MessageEvent.RoomMessage,
        content: {
          body: hugeBody,
          msgtype: MsgType.Text,
        },
      } as never,
      ['CINNY-024']
    );

    expect(preview).toContain('CINNY-024');
    expect(preview.startsWith('…')).toBe(true);
    expect(preview.endsWith('…')).toBe(true);
  });
});

describe('getSearchResultBodySnippet', () => {
  it('anchors long snippets around the first highlight', () => {
    const body = `${'a'.repeat(2000)} CINNY-024 ${'b'.repeat(2000)}`;

    const snippet = getSearchResultBodySnippet(body, ['CINNY-024'], 200);

    expect(snippet).toContain('CINNY-024');
    expect(snippet.length).toBeLessThanOrEqual(202);
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });

  it('anchors around the earliest matching highlight regardless of highlight order', () => {
    const body = `${'a'.repeat(1200)} CINNY-023 ${'b'.repeat(800)} CINNY-024 ${'c'.repeat(1200)}`;

    const snippet = getSearchResultBodySnippet(body, ['CINNY-024', 'CINNY-023'], 200);

    expect(snippet).toContain('CINNY-023');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.indexOf('CINNY-023')).toBeGreaterThanOrEqual(0);
    expect(snippet.endsWith('…')).toBe(true);
  });
});

describe('shouldUseLightweightSearchResultBody', () => {
  it('uses the lightweight renderer for long-text search bodies', () => {
    expect(
      shouldUseLightweightSearchResultBody({
        body: 'short',
        msgtype: MsgType.Text,
        'io.mindroom.long_text': {
          version: 2,
        },
      } as never)
    ).toBe(true);
  });

  it('uses the lightweight renderer for oversized text bodies', () => {
    expect(
      shouldUseLightweightSearchResultBody({
        body: 'x'.repeat(1000),
        msgtype: MsgType.Text,
      } as never)
    ).toBe(true);
  });

  it('keeps the rich renderer for normal short text bodies', () => {
    expect(
      shouldUseLightweightSearchResultBody({
        body: 'normal search body',
        msgtype: MsgType.Text,
      } as never)
    ).toBe(false);
  });
});

describe('getSearchResultLightweightFormattedBody', () => {
  it('keeps bounded formatted bodies for lightweight rendering', () => {
    expect(
      getSearchResultLightweightFormattedBody({
        body: 'x'.repeat(1000),
        formatted_body: '<p>Hello <strong>world</strong></p>',
        msgtype: MsgType.Text,
      } as never)
    ).toBe('<p>Hello <strong>world</strong></p>');
  });

  it('drops oversized formatted bodies on the lightweight path', () => {
    expect(
      getSearchResultLightweightFormattedBody({
        body: 'x'.repeat(1000),
        formatted_body: `<p>${'x'.repeat(6000)}</p>`,
        msgtype: MsgType.Text,
      } as never)
    ).toBeUndefined();
  });
});

describe('getSearchResultLightweightCustomBody', () => {
  it('falls back to lightweight formatted_body when present', () => {
    expect(
      getSearchResultLightweightCustomBody(
        {
          body: 'ignored',
          formatted_body: '<p>Hello <strong>world</strong></p>',
          msgtype: MsgType.Text,
        } as never,
        'Hello world'
      )
    ).toBe('<p>Hello <strong>world</strong></p>');
  });

  it('derives markdown html from the preview text when no formatted body exists', () => {
    expect(
      getSearchResultLightweightCustomBody(
        {
          body: '## Heading\n\n**bold** `code`',
          msgtype: MsgType.Text,
        } as never,
        '## Heading\n\n**bold** `code`'
      )
    ).toContain('<h2');
  });

  it('returns undefined for plain preview text without markdown', () => {
    expect(
      getSearchResultLightweightCustomBody(
        {
          body: 'plain body',
          msgtype: MsgType.Text,
        } as never,
        'plain body'
      )
    ).toBeUndefined();
  });
});
