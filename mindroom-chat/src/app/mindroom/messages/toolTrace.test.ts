import { describe, expect, it } from 'vitest';
import {
  getMindroomToolTraceEventByIndex,
  getMindroomToolTraceEvents,
  isMindroomToolTraceV2,
} from './toolTrace';

describe('isMindroomToolTraceV2', () => {
  it('returns true only for version 2 traces', () => {
    expect(isMindroomToolTraceV2({})).toBe(false);
    expect(isMindroomToolTraceV2({ 'io.mindroom.tool_trace': { version: 1 } })).toBe(false);
    expect(isMindroomToolTraceV2({ 'io.mindroom.tool_trace': { version: 2 } })).toBe(true);
  });
});

describe('getMindroomToolTraceEvents', () => {
  it('returns structured events when present', () => {
    const events = getMindroomToolTraceEvents({
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          { type: 'tool_call_started', tool_name: 'search_web', args_preview: 'q=test' },
          { type: 'tool_call_completed', tool_name: 'search_web', result_preview: 'Done' },
        ],
      },
    });

    expect(events).toHaveLength(2);
    expect(events?.[0]).toMatchObject({ type: 'tool_call_started', tool_name: 'search_web' });
  });

  it('filters invalid event entries and returns undefined when empty', () => {
    expect(
      getMindroomToolTraceEvents({
        'io.mindroom.tool_trace': {
          version: 2,
          events: [null, 'bad', 123],
        },
      })
    ).toBeUndefined();
  });
});

describe('getMindroomToolTraceEventByIndex', () => {
  it('looks up events by 1-based tool ref index', () => {
    const content = {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          { type: 'tool_call_started', tool_name: 'search_web' },
          { type: 'tool_call_completed', tool_name: 'read_file' },
        ],
      },
    };

    expect(getMindroomToolTraceEventByIndex(content, 1)).toMatchObject({
      tool_name: 'search_web',
    });
    expect(getMindroomToolTraceEventByIndex(content, 2)).toMatchObject({
      tool_name: 'read_file',
    });
    expect(getMindroomToolTraceEventByIndex(content, 0)).toBeUndefined();
    expect(getMindroomToolTraceEventByIndex(content, 3)).toBeUndefined();
  });
});
