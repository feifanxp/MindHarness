import { describe, expect, it } from 'vitest';

import { copyMindroomResolvedEditMetadata } from './editMetadata';

describe('copyMindroomResolvedEditMetadata', () => {
  it('copies only missing MindRoom metadata from edit wrapper sources in priority order', () => {
    const resolvedContent: Record<string, unknown> = {
      body: 'Final answer',
      msgtype: 'm.text',
      'io.mindroom.ai_run': { version: 1, status: 'streaming' },
    };

    copyMindroomResolvedEditMetadata(resolvedContent, [
      {
        'm.new_content': {
          'io.mindroom.tool_trace': {
            version: 2,
            events: [{ type: 'tool_call_completed', tool_name: 'run_shell_command' }],
          },
        },
        'io.mindroom.ai_run': { version: 1, status: 'completed' },
        'io.mindroom.stream_status': 'completed',
        'm.mentions': { user_ids: ['@alice:example.org'] },
        'org.example.unrelated': true,
      },
      {
        'com.mindroom.skip_mentions': true,
        'io.mindroom.stream_status': 'streaming',
      },
    ]);

    expect(resolvedContent).toEqual({
      body: 'Final answer',
      msgtype: 'm.text',
      'io.mindroom.ai_run': { version: 1, status: 'streaming' },
      'io.mindroom.tool_trace': {
        version: 2,
        events: [{ type: 'tool_call_completed', tool_name: 'run_shell_command' }],
      },
      'io.mindroom.stream_status': 'completed',
      'com.mindroom.skip_mentions': true,
    });
  });

  it('does not carry a long-text marker into a later edit', () => {
    // The marker means "this event's file holds the message"; it is true only beside that file.
    const shortEdit: Record<string, unknown> = { msgtype: 'm.text', body: 'Short now' };

    copyMindroomResolvedEditMetadata(shortEdit, [
      {
        'm.new_content': {
          msgtype: 'm.file',
          body: 'The start of a long edit',
          url: 'mxc://example.org/sidecar',
          'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
        },
      },
    ]);

    expect(shortEdit).toEqual({ msgtype: 'm.text', body: 'Short now' });
  });
});
