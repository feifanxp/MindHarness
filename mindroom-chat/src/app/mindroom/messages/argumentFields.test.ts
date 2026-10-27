import { describe, expect, it } from 'vitest';
import {
  mergeArgumentFields,
  orderArgumentFields,
  pickPreviewFields,
  summarizeArguments,
  toArgumentFields,
  toToolArgumentFields,
} from './argumentFields';

describe('toArgumentFields', () => {
  it('keeps object keys in event order as labeled fields', () => {
    expect(
      toArgumentFields({ to: 'grace@example.org', subject: 'Release notes', body: 'Hi\nGrace' })
    ).toEqual({
      fields: [
        { key: 'to', value: { kind: 'text', text: 'grace@example.org' } },
        { key: 'subject', value: { kind: 'text', text: 'Release notes' } },
        { key: 'body', value: { kind: 'text', text: 'Hi\nGrace' } },
      ],
    });
  });

  it('parses a top-level JSON string, as tool-call previews arrive', () => {
    expect(toArgumentFields('{"query": "MindRoom release notes"}')).toEqual({
      fields: [{ key: 'query', value: { kind: 'text', text: 'MindRoom release notes' } }],
    });
  });

  it('unpacks string values that hold a JSON object one level deep', () => {
    expect(
      toArgumentFields({ payload: JSON.stringify({ channel: '#research', silent: true }) })
    ).toEqual({
      fields: [
        {
          key: 'payload',
          value: {
            kind: 'nested',
            fields: [
              { key: 'channel', value: { kind: 'text', text: '#research' } },
              { key: 'silent', value: { kind: 'scalar', text: 'true' } },
            ],
          },
        },
      ],
    });
  });

  it('shows nested objects as fields and anything deeper as formatted JSON', () => {
    expect(toArgumentFields({ options: { retries: 2, headers: { accept: 'json' } } })).toEqual({
      fields: [
        {
          key: 'options',
          value: {
            kind: 'nested',
            fields: [
              { key: 'retries', value: { kind: 'scalar', text: '2' } },
              { key: 'headers', value: { kind: 'json', text: '{\n  "accept": "json"\n}' } },
            ],
          },
        },
      ],
    });
  });

  it('renders numbers, booleans, null, and short primitive lists as scalars', () => {
    expect(toArgumentFields({ count: 3, dry_run: false, cc: null, tags: ['a', 'b'] })).toEqual({
      fields: [
        { key: 'count', value: { kind: 'scalar', text: '3' } },
        { key: 'dry_run', value: { kind: 'scalar', text: 'false' } },
        { key: 'cc', value: { kind: 'scalar', text: 'null' } },
        { key: 'tags', value: { kind: 'scalar', text: 'a, b' } },
      ],
    });
  });

  it('formats empty, long, or complex lists as JSON', () => {
    const rows = [{ id: 1 }, { id: 2 }];
    expect(toArgumentFields({ cc: [], rows })).toEqual({
      fields: [
        { key: 'cc', value: { kind: 'scalar', text: '[]' } },
        { key: 'rows', value: { kind: 'json', text: JSON.stringify(rows, null, 2) } },
      ],
    });
  });

  it('falls back to raw text when a string is not complete JSON', () => {
    expect(toArgumentFields('{"query": "MindRoom rel…')).toEqual({
      raw: '{"query": "MindRoom rel…',
    });
  });

  it('falls back to formatted JSON when the top level is not an object', () => {
    expect(toArgumentFields(['a', 'b'])).toEqual({ raw: '[\n  "a",\n  "b"\n]' });
    expect(toArgumentFields(undefined)).toEqual({ raw: '' });
  });
});

describe('toToolArgumentFields', () => {
  it('splits the key=value preview MindRoom writes for tool calls', () => {
    expect(toToolArgumentFields('query=MindRoom v2026.10.12 release notes, max_results=5')).toEqual(
      {
        fields: [
          { key: 'query', value: { kind: 'text', text: 'MindRoom v2026.10.12 release notes' } },
          { key: 'max_results', value: { kind: 'text', text: '5' } },
        ],
      }
    );
  });

  it('unpacks values MindRoom wrote as compact JSON', () => {
    expect(toToolArgumentFields('payload={"channel": "#research"}, dry_run=true')).toEqual({
      fields: [
        {
          key: 'payload',
          value: {
            kind: 'nested',
            fields: [{ key: 'channel', value: { kind: 'text', text: '#research' } }],
          },
        },
        { key: 'dry_run', value: { kind: 'text', text: 'true' } },
      ],
    });
  });

  it('keeps commas that are not followed by another key inside the value', () => {
    expect(toToolArgumentFields('text=Hi Grace, three changes, to=grace@example.org')).toEqual({
      fields: [
        { key: 'text', value: { kind: 'text', text: 'Hi Grace, three changes' } },
        { key: 'to', value: { kind: 'text', text: 'grace@example.org' } },
      ],
    });
  });

  it('accepts a JSON preview and falls back to raw text without a leading key', () => {
    expect(toToolArgumentFields('{"query": "x"}')).toEqual({
      fields: [{ key: 'query', value: { kind: 'text', text: 'x' } }],
    });
    expect(toToolArgumentFields('reading the notes')).toEqual({ raw: 'reading the notes' });
  });
});

describe('pickPreviewFields', () => {
  it('previews the first filled-in fields in the same order the full list uses', () => {
    // Matrix canonical JSON sorts keys, so events arrive with body before to.
    const parsed = toArgumentFields({
      body: 'Hi Grace,\n\nHere is what changed between the releases.',
      cc: [],
      subject: 'Release notes',
      to: 'grace@example.org',
    });
    if (!('fields' in parsed)) throw new Error('expected fields');
    expect(orderArgumentFields(parsed.fields).map((field) => field.key)).toEqual([
      'to',
      'cc',
      'subject',
      'body',
    ]);
    expect(pickPreviewFields(parsed.fields, 3).map((field) => field.key)).toEqual([
      'to',
      'subject',
      'body',
    ]);
  });

  it('puts long values last and keeps other keys in event order', () => {
    const parsed = toArgumentFields({
      payload: JSON.stringify({
        type: 'release',
        title: 'v2026.10.12 is live',
        notes: 'x'.repeat(80),
      }),
      retries: 2,
      url: 'https://status.example.org/api/v1/announcements',
      zone: 'eu',
    });
    if (!('fields' in parsed)) throw new Error('expected fields');
    expect(orderArgumentFields(parsed.fields).map((field) => field.key)).toEqual([
      'url',
      'retries',
      'zone',
      'payload',
    ]);
  });
});

describe('summarizeArguments', () => {
  it('names the most telling argument on one line', () => {
    expect(summarizeArguments({ encoding: '', path: 'docs/changelog.md' })).toBe(
      'path docs/changelog.md'
    );
    expect(summarizeArguments({ body: 'Hi\n\nGrace', to: 'grace@example.org' })).toBe(
      'to grace@example.org'
    );
  });

  it('returns nothing when there are no labeled arguments', () => {
    expect(summarizeArguments('not json')).toBeUndefined();
    expect(summarizeArguments({})).toBeUndefined();
  });
});

describe('mergeArgumentFields', () => {
  it('shows shared values once and joins values that differ between calls', () => {
    expect(
      mergeArgumentFields([
        { room: '#launch-war-room', text: 'Release notes are out' },
        { room: '#research', text: 'Release notes are out' },
      ])
    ).toEqual({
      fields: [
        { key: 'room', value: { kind: 'text', text: '#launch-war-room · #research' } },
        { key: 'text', value: { kind: 'text', text: 'Release notes are out' } },
      ],
    });
  });

  it('shows a field that only a later call carries', () => {
    expect(
      mergeArgumentFields([
        { to: 'ana@example.com' },
        { to: 'ana@example.com', cc: 'ben@example.com' },
      ])
    ).toEqual({
      fields: [
        { key: 'to', value: { kind: 'text', text: 'ana@example.com' } },
        { key: 'cc', value: { kind: 'text', text: 'ben@example.com' } },
      ],
    });
  });

  it('keeps the first call when the calls are not all labeled objects', () => {
    expect(mergeArgumentFields(['raw', { room: '#a' }])).toEqual({ raw: 'raw' });
    expect(mergeArgumentFields([{ room: '#a' }])).toEqual({
      fields: [{ key: 'room', value: { kind: 'text', text: '#a' } }],
    });
  });
});
