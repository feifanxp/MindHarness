import { describe, expect, it } from 'vitest';

import backendBodies from './__fixtures__/backendToolMarkerBodies.json';
import {
  getMessageCopyTexts,
  getMessageCopyTextSource,
  isCopyTextMessageContent,
  scanMindroomToolMarkerLines,
  type MessageCopyTextSource,
} from './messageCopyText';
import type { MindroomToolTraceEvent } from './toolTrace';

const TOOL_TRACE_KEY = 'io.mindroom.tool_trace';

const getMessageCopyTextBody = (
  ...args: Parameters<typeof getMessageCopyTextSource>
): string | undefined => getMessageCopyTextSource(...args)?.body;

describe('getMessageCopyTextSource body selection', () => {
  it('prefers the edited wrapper body when present', () => {
    expect(
      getMessageCopyTextBody(
        {
          body: 'edited plain text',
          'm.new_content': {
            formatted_body: '<strong>edited</strong>',
          },
        },
        { body: 'original text' }
      )
    ).toBe('edited plain text');
  });

  it('falls back to m.new_content.body when wrapper body is absent', () => {
    expect(
      getMessageCopyTextBody(
        {
          'm.new_content': {
            body: 'edited plain text',
          },
        },
        { body: 'original text' }
      )
    ).toBe('edited plain text');
  });

  it('falls back to the original event body when edited content has no plain text body', () => {
    expect(
      getMessageCopyTextBody(
        {
          'm.new_content': {
            formatted_body: '<strong>edited</strong>',
          },
        },
        { body: 'original text' }
      )
    ).toBe('original text');
  });

  describe('overflow long-text resolution', () => {
    it('prefers the resolved long-text body over the wrapper placeholder', () => {
      expect(
        getMessageCopyTextBody(
          {
            msgtype: 'm.file',
            body: 'Long text overflow...',
            url: 'mxc://mindroom/overflow',
            'io.mindroom.long_text': {
              version: 2,
              encoding: 'matrix_event_content_json',
            },
          },
          { body: 'original placeholder' },
          {
            msgtype: 'm.text',
            body: 'Actual long response',
          }
        )
      ).toBe('Actual long response');
    });

    it('falls back to resolved m.new_content.body when the resolved wrapper body is absent', () => {
      expect(
        getMessageCopyTextBody(
          {
            msgtype: 'm.file',
            body: 'Long text overflow...',
          },
          { body: 'original placeholder' },
          {
            msgtype: 'm.text',
            'm.new_content': {
              msgtype: 'm.text',
              body: 'Edited resolved body',
            },
          }
        )
      ).toBe('Edited resolved body');
    });

    it('falls back to the existing envelope chain when no resolved long-text content is provided', () => {
      expect(
        getMessageCopyTextBody(
          {
            msgtype: 'm.file',
            body: 'Long text overflow...',
          },
          { body: 'original placeholder' }
        )
      ).toBe('Long text overflow...');
    });

    it('falls through when neither the resolved content nor the envelope has a plain body', () => {
      expect(
        getMessageCopyTextBody(
          {
            msgtype: 'm.file',
            'm.new_content': {
              formatted_body: '<p>formatted only</p>',
            },
          },
          {
            formatted_body: '<p>still formatted only</p>',
          },
          {
            msgtype: 'm.text',
            body: '',
            'm.new_content': {
              msgtype: 'm.text',
              body: '',
            },
          }
        )
      ).toBeUndefined();
    });
  });
});

describe('isCopyTextMessageContent', () => {
  it('allows text-like msgtypes', () => {
    expect(isCopyTextMessageContent({ msgtype: 'm.text' })).toBe(true);
    expect(isCopyTextMessageContent({ msgtype: 'm.notice' })).toBe(true);
    expect(isCopyTextMessageContent({ msgtype: 'm.emote' })).toBe(true);
  });

  it('rejects non-text msgtypes', () => {
    expect(isCopyTextMessageContent({ msgtype: 'm.image' })).toBe(false);
    expect(isCopyTextMessageContent({ msgtype: 'm.file' })).toBe(false);
    expect(isCopyTextMessageContent({})).toBe(false);
  });
});

describe('getMessageCopyTextSource', () => {
  const trace = (toolName: string) => ({
    version: 2,
    events: [{ type: 'tool_call_completed', tool_name: toolName }],
  });

  it('reads tool trace events from the resolved long-text content that supplied the body', () => {
    const source = getMessageCopyTextSource(
      {
        msgtype: 'm.file',
        body: 'Long text overflow...',
        [TOOL_TRACE_KEY]: trace('envelope_tool'),
      },
      { body: 'original placeholder' },
      {
        msgtype: 'm.text',
        body: 'Actual long response',
        [TOOL_TRACE_KEY]: trace('resolved_tool'),
      }
    );

    expect(source?.body).toBe('Actual long response');
    expect(source?.toolTraceEvents?.[0]?.tool_name).toBe('resolved_tool');
  });

  it('keeps hydrated long text on its own trace like the renderer', () => {
    const source = getMessageCopyTextSource(
      {
        body: 'wrapper body',
        [TOOL_TRACE_KEY]: trace('wrapper_tool'),
      },
      { body: 'original body' },
      {
        msgtype: 'm.text',
        body: 'resolved body',
      }
    );

    expect(source?.body).toBe('resolved body');
    expect(source?.toolTraceEvents).toBeUndefined();
  });

  it('falls back to the edit wrapper trace when the body comes from m.new_content', () => {
    const source = getMessageCopyTextSource(
      {
        'm.new_content': { body: 'edited body' },
        [TOOL_TRACE_KEY]: trace('wrapper_tool'),
      },
      { body: 'original body' }
    );

    expect(source?.body).toBe('edited body');
    expect(source?.toolTraceEvents?.[0]?.tool_name).toBe('wrapper_tool');
  });

  it('ignores traces that are not version 2', () => {
    const source = getMessageCopyTextSource(
      {
        body: 'body',
        [TOOL_TRACE_KEY]: { version: 1, events: [{ tool_name: 'legacy' }] },
      },
      {}
    );

    expect(source?.body).toBe('body');
    expect(source?.toolTraceEvents).toBeUndefined();
  });

  it('takes formatted_body from the same content as the body', () => {
    const edited = getMessageCopyTextSource(
      {
        body: '* edited',
        formatted_body: '<p>* edited</p>',
        'm.new_content': { body: 'edited', formatted_body: '<p>edited</p>' },
      },
      { body: 'original', formatted_body: '<p>original</p>' }
    );
    expect(edited).toMatchObject({ body: '* edited', formattedBody: '<p>* edited</p>' });

    const newContentOnly = getMessageCopyTextSource(
      { 'm.new_content': { body: 'edited', formatted_body: '<p>edited</p>' } },
      { body: 'original', formatted_body: '<p>original</p>' }
    );
    expect(newContentOnly).toMatchObject({ body: 'edited', formattedBody: '<p>edited</p>' });

    const hydrated = getMessageCopyTextSource(
      { body: 'preview', formatted_body: '<p>preview</p>' },
      {},
      { body: 'full' }
    );
    expect(hydrated).toMatchObject({ body: 'full', formattedBody: undefined });
  });

  it('uses the plain-body fallback only for plain events', () => {
    expect(getMessageCopyTextSource({ body: 'plain' }, {})?.plainBodyFallback).toBe(true);
    expect(
      getMessageCopyTextSource({ body: 'preview', 'io.mindroom.long_text': { version: 2 } }, {})
        ?.plainBodyFallback
    ).toBe(false);
    expect(
      getMessageCopyTextSource({ body: 'preview' }, {}, { body: 'full' })?.plainBodyFallback
    ).toBe(false);
  });

  it('keeps markers of bodies the renderer shows without tool blocks', () => {
    const body = 'Example:\n\n```\n🔧 `search` [1]\n```\n\nMore';
    const source = getMessageCopyTextSource(
      { msgtype: 'm.file', body, 'io.mindroom.long_text': { version: 2 } },
      {}
    );
    expect(source?.plainBodyFallback).toBe(false);
    expect(
      source &&
        getMessageCopyTexts(
          source,
          scanMindroomToolMarkerLines(source.body, source.formattedBody, source.plainBodyFallback)
        )
    ).toEqual({ text: body });
  });

  it('returns undefined when no plain body exists', () => {
    expect(getMessageCopyTextSource({ formatted_body: '<p>x</p>' }, {})).toBeUndefined();
  });
});

// Bodies without formatted_body render through the plain-body fallback, which
// shows every standalone marker line as a tool block.
const copyTexts = (source: Omit<MessageCopyTextSource, 'plainBodyFallback'>) => {
  const fullSource = { plainBodyFallback: true, ...source };
  return getMessageCopyTexts(
    fullSource,
    scanMindroomToolMarkerLines(fullSource.body, fullSource.formattedBody, true)
  );
};
const copy = (body: string, toolTraceEvents?: MindroomToolTraceEvent[]) =>
  copyTexts({ body, toolTraceEvents });
const copyText = (body: string) => copy(body).text;

describe('getMessageCopyTexts plain copy', () => {
  it('returns bodies without markers unchanged', () => {
    const body = 'Line one\r\n\r\n\r\nLine two  \n';
    expect(copy(body)).toEqual({ text: body });
  });

  it('removes marker lines together with their spacing', () => {
    expect(
      copyText('Let me check.\n\n🔧 `search_web` [1]\n\n🔧 `read_file` [2] ⏳\n\nIt is sunny.')
    ).toBe('Let me check.\n\nIt is sunny.');
  });

  it('collapses wide gaps before markers to one blank line', () => {
    expect(
      copyText(
        'Understood.\n\n\n\n\n🔧 `shell` [1]\n\nGot it.\n\n  \n\n\n\n🔧 `shell` [2]\n\n\n\nI found it.'
      )
    ).toBe('Understood.\n\nGot it.\n\nI found it.');
    expect(
      copyTexts({
        body: 'Understood.\n\n\n\n\n🔧 `shell` [1]\n\nGot it.',
        formattedBody: '<p>Understood.</p>\n<p>🔧 <code>shell</code> [1]</p>\n<p>Got it.</p>\n',
      }).text
    ).toBe('Understood.\n\nGot it.');
  });

  it('removes leading and trailing markers', () => {
    expect(copyText('🔧 `a` [1]\n\nAnswer\n\n🔧 `b` [2]\n')).toBe('Answer');
  });

  it('keeps a paragraph break where an unspaced marker line rendered as a tool block', () => {
    expect(copyText('text\n🔧 `a` [1]\nmore')).toBe('text\n\nmore');
  });

  it('normalizes CRLF bodies that contain markers', () => {
    expect(copyText('A\r\n\r\n🔧 `a` [1]\r\n\r\nB\r\n')).toBe('A\n\nB');
  });

  it('keeps LaTeX while stripping markers', () => {
    expect(copyText('$$\nE = mc^2\n$$\n\n🔧 `calculator` [1]\n\nUse $x^2$.')).toBe(
      '$$\nE = mc^2\n$$\n\nUse $x^2$.'
    );
  });

  it('copies the body unchanged when 🔧 also appears outside marker lines', () => {
    const body = 'A\n\n🔧 `calculator` [1]\n\nUse 🔧 `x` [2] inline.';
    expect(copy(body)).toEqual({ text: body });
  });

  it('keeps every line of a tool index the body mentions more than once', () => {
    const body = 'I used 🔧 `search` [1] before.\n\n🔧 `search` [1]\n\nAnswer';
    expect(copy(body)).toEqual({ text: body });
  });

  it('copies the body unchanged when a body 🔧 is not on a marker line', () => {
    const body = 'Use 🔧 here\n\n🔧 `x` [1]';
    expect(
      copyTexts({ body, formattedBody: '<p>Use here</p><p>🔧 <code>x</code> [1]</p>' })
    ).toEqual({ text: body });
  });

  it('copies the body unchanged when marker lines and tool blocks differ in number', () => {
    const body = '🔧 `x` [1]\n\n&#x1F527; `y` [2]';
    expect(
      copyTexts({
        body,
        formattedBody: '<p>🔧 <code>x</code> [1]</p><p>🔧 <code>y</code> [2]</p>',
      })
    ).toEqual({ text: body });
  });

  it('keeps markers whose tool name differs from the displayed tool block', () => {
    const body = 'A\n\n🔧 `search` [1]\n\nB';
    expect(copyTexts({ body, formattedBody: '<p>A</p><p>🔧 <code>other</code> [1]</p>' })).toEqual({
      text: body,
    });
  });
});

describe('getMessageCopyTexts tool-call copy', () => {
  it('replaces markers with the structured tool trace', () => {
    expect(
      copy('Let me check.\n\n🔧 `search_web` [1]\n\nIt is sunny.', [
        {
          type: 'tool_call_completed',
          tool_name: 'search_web',
          args_preview: 'query=weather Amsterdam',
          result_preview: 'Sunny, 21°C\nLight wind',
        },
      ])
    ).toEqual({
      text: 'Let me check.\n\nIt is sunny.',
      textWithToolCalls: [
        'Let me check.',
        '',
        '**🔧 Tool call 1**',
        '',
        '```',
        'search_web(query=weather Amsterdam)',
        '```',
        '',
        'Result:',
        '',
        '```',
        'Sunny, 21°C',
        'Light wind',
        '```',
        '',
        'It is sunny.',
      ].join('\n'),
    });
  });

  it('marks running, truncated, and unavailable tool calls', () => {
    expect(
      copy('A\n\n🔧 `shell` [1] ⏳\n🔧 `read_file` [2]\n\n🔧 `lost` [3]\n\n🔧 `waiting` [4] ⏳', [
        { type: 'tool_call_started', tool_name: 'shell' },
        {
          type: 'tool_call_completed',
          tool_name: 'read_file',
          args_preview: 'path=a.md',
          truncated: true,
        },
      ]).textWithToolCalls
    ).toBe(
      [
        'A',
        '',
        '**🔧 Tool call 1 (running)**',
        '',
        '```',
        'shell',
        '```',
        '',
        '**🔧 Tool call 2 (preview truncated)**',
        '',
        '```',
        'read_file(path=a.md)',
        '```',
        '',
        '**🔧 Tool call 3 (details unavailable)**',
        '',
        '```',
        'lost',
        '```',
        '',
        '**🔧 Tool call 4 (running, details unavailable)**',
        '',
        '```',
        'waiting',
        '```',
      ].join('\n')
    );
  });

  it('collapses wide gaps before tool calls to one blank line', () => {
    expect(
      copy('Understood.\n\n\n\n\n🔧 `shell` [1]\n\n\n\nGot it.', [
        { type: 'tool_call_completed', tool_name: 'shell' },
      ]).textWithToolCalls
    ).toBe('Understood.\n\n**🔧 Tool call 1**\n\n```\nshell\n```\n\nGot it.');
  });

  it('keeps pending markers whose event has no type marked as running', () => {
    expect(copy('A\n\n🔧 `read_file` [1] ⏳', [{ tool_name: 'read_file' }]).textWithToolCalls).toBe(
      'A\n\n**🔧 Tool call 1 (running)**\n\n```\nread_file\n```'
    );
  });

  it('preserves result indentation and normalizes result line endings', () => {
    expect(
      copy('A\n\n🔧 `read_file` [1]', [
        {
          type: 'tool_call_completed',
          tool_name: 'read_file',
          result_preview: '\r\n    indented\r\n  second  \r\n\r\n',
        },
      ]).textWithToolCalls
    ).toBe(
      [
        'A',
        '',
        '**🔧 Tool call 1**',
        '',
        '```',
        'read_file',
        '```',
        '',
        'Result:',
        '',
        '```',
        '    indented',
        '  second',
        '```',
      ].join('\n')
    );
  });

  it('uses fences longer than any backtick run in the tool data', () => {
    expect(
      copy('A\n\n🔧 `read_file` [1]', [
        {
          type: 'tool_call_completed',
          tool_name: 'read_file',
          result_preview: '```js\nconst x = 1;\n```',
        },
      ]).textWithToolCalls
    ).toBe(
      [
        'A',
        '',
        '**🔧 Tool call 1**',
        '',
        '```',
        'read_file',
        '```',
        '',
        'Result:',
        '',
        '````',
        '```js',
        'const x = 1;',
        '```',
        '````',
      ].join('\n')
    );
  });

  it('copies the tool calls of a reply that has no other text', () => {
    expect(copy('🔧 `search` [1]', [{ type: 'tool_call_completed', tool_name: 'search' }])).toEqual(
      { text: '**🔧 Tool call 1**\n\n```\nsearch\n```' }
    );
  });
});

// Captured from MindRoom's markdown_to_html (backend f5aaea2b0), which builds
// formatted_body, by scripts/capture-backend-tool-marker-bodies.py. The bodies
// skip format_message_with_mentions, whose marker spacing every send applies,
// so some layouts (unspaced markers) only arise from model-written text.
// `text: undefined` means copy cannot prove which lines are the displayed tool
// blocks, so the body copies unchanged.
const BACKEND_COPY_EXPECTATIONS: Record<
  keyof typeof backendBodies,
  { text: string | undefined; toolCallCopy: boolean }
> = {
  'reply with one tool call': { text: 'Let me check.\n\nIt is sunny.', toolCallCopy: true },
  'grouped and pending tool calls': { text: 'Let me check.\n\nIt is sunny.', toolCallCopy: true },
  'leading and trailing tool calls': { text: 'Answer', toolCallCopy: true },
  'tool calls only': {
    text: '**🔧 Tool call 1 (running, details unavailable)**\n\n```\nshell\n```',
    toolCallCopy: false,
  },
  'LaTeX around a tool call': {
    text: '$$\nE = mc^2\n$$\n\nInline $x^2$ stays.',
    toolCallCopy: true,
  },
  'list-marker line inside a fence': { text: undefined, toolCallCopy: false },
  'quote-marker line inside a fence': { text: undefined, toolCallCopy: false },
  'indented fence-like line inside a fence': { text: undefined, toolCallCopy: false },
  'indented code block containing a fence': {
    text: 'Example:\n\n    ```\n    code\n\nAnswer',
    toolCallCopy: true,
  },
  'fence closed by the end of its block quote': {
    text: '> ```\n> code\n\nAnswer',
    toolCallCopy: true,
  },
  'fence closed by the end of its list item': {
    text: '- ```\n  code\n\nAnswer',
    toolCallCopy: true,
  },
  'unclosed fence while streaming': { text: undefined, toolCallCopy: false },
  'tool call inside display math': { text: undefined, toolCallCopy: false },
  'tool call after an escaped HTML comment opener': { text: '<!--\n\nAnswer', toolCallCopy: true },
  'tool call inside an allowed HTML block': { text: undefined, toolCallCopy: false },
  'unspaced tool call inside a paragraph': { text: undefined, toolCallCopy: false },
  'tool call as a list item': { text: undefined, toolCallCopy: false },
  'code example repeating a real tool call': { text: undefined, toolCallCopy: false },
  'inline mention of a real tool call': { text: undefined, toolCallCopy: false },
  'CRLF line endings': { text: 'A\n\nB', toolCallCopy: true },
  'tool call inside a block quote': { text: undefined, toolCallCopy: false },
  'tool call between list items': { text: undefined, toolCallCopy: false },
  'tool call inside a heading': { text: undefined, toolCallCopy: false },
  'unspaced consecutive tool calls': { text: 'Answer', toolCallCopy: true },
  'double-backtick marker with a canonical copy in code': { text: undefined, toolCallCopy: false },
  'HTML-code marker with a canonical copy in code': { text: undefined, toolCallCopy: false },
  'escaped-bracket marker with a canonical copy in code': { text: undefined, toolCallCopy: false },
  'entity-bracket marker with a canonical copy in code': { text: undefined, toolCallCopy: false },
  'reference link definition sharing a marker index': { text: undefined, toolCallCopy: false },
  'reference-style link in a reply with a tool call': { text: undefined, toolCallCopy: false },
  'table row with a pipe in the tool name': { text: undefined, toolCallCopy: false },
  'tool name containing another index': { text: undefined, toolCallCopy: false },
  'tool name containing an earlier index': { text: undefined, toolCallCopy: false },
  'wide gap before the pending marker': { text: undefined, toolCallCopy: false },
  'entity tool block beside a marker in indented code': { text: undefined, toolCallCopy: false },
  'entity tool block beside a marker in display math': { text: undefined, toolCallCopy: false },
  'entity tool block beside a marker in a code span': { text: undefined, toolCallCopy: false },
  'entity tool block beside a marker after a comment opener': {
    text: undefined,
    toolCallCopy: false,
  },
  // The renderer shows these markers, but copy cannot prove it and keeps them.
  'tool call inside a raw div': { text: undefined, toolCallCopy: false },
  'tool call inside a details block': { text: undefined, toolCallCopy: false },
  'tool call followed by text on the same line': { text: undefined, toolCallCopy: false },
};

describe('getMessageCopyTexts backend formatted_body parity', () => {
  it.each(Object.entries(backendBodies))('%s', (name, { body, formatted_body: formattedBody }) => {
    const expected = BACKEND_COPY_EXPECTATIONS[name as keyof typeof backendBodies];
    const texts = copyTexts({ body, formattedBody });

    expect(texts.text).toBe(expected.text ?? body);
    expect(texts.textWithToolCalls !== undefined).toBe(expected.toolCallCopy);
  });
});
