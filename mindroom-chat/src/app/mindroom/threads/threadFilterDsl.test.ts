import { describe, expect, it } from 'vitest';
import type { ThreadFilterState } from './roomThreadOverviewModel';
import { parseThreadFilterQuery, serializeThreadFilterQuery } from './threadFilterDsl';

const makeState = (overrides: Partial<ThreadFilterState> = {}): ThreadFilterState => ({
  resolved: 'any',
  streaming: 'any',
  scheduled: 'any',
  unread: 'any',
  idle: 'any',
  sortBy: 'lastReply',
  sortDirection: 'desc',
  tags: new Map(),
  freeText: '',
  unsupportedQuery: '',
  statusMode: 'and',
  ...overrides,
});
const expectParsed = (
  text: string,
  expected: {
    status?: Partial<Record<keyof Pick<ThreadFilterState, 'resolved' | 'streaming' | 'scheduled' | 'unread' | 'idle'>, ThreadFilterState['resolved']>>;
    tags?: [string, ThreadFilterState['resolved']][];
    statusMode?: 'and' | 'or';
    freeText?: string;
    unsupportedTail?: string;
  }
) => {
  const parsed = parseThreadFilterQuery(text);
  expect(parsed.status).toEqual(expected.status ?? {});
  expect([...parsed.tags]).toEqual(expected.tags ?? []);
  expect(parsed.statusMode).toBe(expected.statusMode ?? 'and');
  expect(parsed.freeText).toBe(expected.freeText ?? '');
  expect(parsed.unsupportedTail).toBe(expected.unsupportedTail ?? '');
};
describe('threadFilterDsl', () => {
  it.each([
    ['', {}],
    ['is:streaming', { status: { streaming: 'include' } }],
    ['is:streaming OR is:scheduled', { status: { streaming: 'include', scheduled: 'include' }, statusMode: 'or' }],
    ['-is:resolved', { status: { resolved: 'exclude' } }],
    ['tag:bug', { tags: [['bug', 'include']] }],
    ['-tag:bug', { tags: [['bug', 'exclude']] }],
    ['is:streaming foo bar', { status: { streaming: 'include' }, freeText: 'foo bar' }],
    ['IS:STREAMING or IS:SCHEDULED', { status: { streaming: 'include', scheduled: 'include' }, statusMode: 'or' }],
    ['is:bogus', { unsupportedTail: 'is:bogus' }],
    ['tag:a OR tag:b', { unsupportedTail: 'tag:a OR tag:b' }],
    ['is:streaming OR is:scheduled tag:bug', { status: { streaming: 'include', scheduled: 'include' }, statusMode: 'or', tags: [['bug', 'include']] }],
    ['is:streaming OR tag:bug', { unsupportedTail: 'is:streaming OR tag:bug' }],
    ['is:streaming OR is:scheduled is:unread OR is:idle', { status: { streaming: 'include', scheduled: 'include' }, statusMode: 'or', unsupportedTail: 'is:unread OR is:idle' }],
  ])('parses %s', (text, expected) => expectParsed(text, expected));

  it('keeps colon-bearing free text searchable when it is not DSL syntax', () => {
    expectParsed('!room:server hello world', {
      freeText: '!room:server hello world',
    });
  });

  it('serializes canonical filter text in the expected order', () => {
    expect(
      serializeThreadFilterQuery(
        makeState({
          streaming: 'include',
          scheduled: 'include',
          unread: 'exclude',
          tags: new Map([
            ['zebra', 'exclude'],
            ['bug', 'include'],
          ]),
          statusMode: 'or',
          freeText: 'foo bar',
          unsupportedQuery: 'tag:a OR tag:b',
        })
      )
    ).toBe('is:streaming OR is:scheduled -is:unread tag:bug -tag:zebra foo bar tag:a OR tag:b');
  });

  it.each([
    'is:streaming',
    'is:streaming OR is:scheduled',
    '-is:resolved',
    'tag:bug',
    '-tag:bug',
    'is:streaming OR is:scheduled -is:resolved tag:bug -tag:blocked foo bar',
  ])('round-trips %s', (text) => {
    const parsed = parseThreadFilterQuery(text);
    expect(
      serializeThreadFilterQuery(
        makeState({
          ...parsed.status,
          tags: parsed.tags,
          statusMode: parsed.statusMode,
          freeText: parsed.freeText,
          unsupportedQuery: parsed.unsupportedTail,
        })
      )
    ).toBe(text);
  });
});
