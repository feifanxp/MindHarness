import { describe, expect, it } from 'vitest';
import { getMindroomLongTextSource, hydrateMindroomLongTextSource } from './longText';
import { getMindroomToolTraceEventByIndex } from './toolTrace';

const expectDefined = <T>(value: T | undefined): T => {
  expect(value).toBeDefined();
  if (value === undefined) {
    throw new Error('Expected value to be defined');
  }
  return value;
};

describe('MindRoom message pipeline', () => {
  it('hydrates full content json with formatted_body and tool-trace metadata', async () => {
    const previewContent = {
      msgtype: 'm.file',
      body: 'preview',
      formatted_body: '<p>preview</p>',
      url: 'mxc://server/full-content',
      'io.mindroom.long_text': {
        version: 2,
        encoding: 'matrix_event_content_json',
      },
    };

    const source = expectDefined(getMindroomLongTextSource(previewContent));

    const resolved = await hydrateMindroomLongTextSource(
      source,
      async () =>
        JSON.stringify({
          msgtype: 'm.text',
          body: 'final answer',
          formatted_body: '<p>🔧 <code>search_web</code> [1]</p>',
          'io.mindroom.tool_trace': {
            version: 2,
            events: [
              {
                type: 'tool_call_completed',
                tool_name: 'search_web',
                result_preview: 'Done',
              },
            ],
          },
        }),
      {}
    );

    expect(resolved.formatted_body).toBe('<p>🔧 <code>search_web</code> [1]</p>');

    expect(getMindroomToolTraceEventByIndex(resolved, 1)?.tool_name).toBe('search_web');
  });
});
