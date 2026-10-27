import { describe, expect, it } from 'vitest';
import { getCommandPaletteSectionOrder, parseCommandPaletteQuery } from './commandPaletteQuery';

describe('parseCommandPaletteQuery', () => {
  it('trims leading whitespace before detecting prefixes', () => {
    expect(parseCommandPaletteQuery('   > open settings')).toEqual({
      raw: '   > open settings',
      prefix: '>',
      mode: 'actions',
      searchText: 'open settings',
      showMessages: false,
    });
  });

  it('keeps prefix-only queries scoped to their section', () => {
    expect(parseCommandPaletteQuery('  @   ')).toEqual({
      raw: '  @   ',
      prefix: '@',
      mode: 'users',
      searchText: '',
      showMessages: false,
    });
  });

  it('keeps the documented star prefix as the spaces alias', () => {
    expect(parseCommandPaletteQuery('* inbox')).toEqual({
      raw: '* inbox',
      prefix: '*',
      mode: 'spaces',
      searchText: 'inbox',
      showMessages: false,
    });
  });

  it('treats unknown prefixes as unified free text', () => {
    expect(parseCommandPaletteQuery('  !deploy')).toEqual({
      raw: '  !deploy',
      prefix: undefined,
      mode: 'all',
      searchText: '!deploy',
      showMessages: true,
    });
  });
});

describe('getCommandPaletteSectionOrder', () => {
  it('puts rooms first in the starter ordering for empty unified search', () => {
    expect(getCommandPaletteSectionOrder(parseCommandPaletteQuery('   '))).toEqual([
      'rooms',
      'threads',
      'actions',
      'users',
    ]);
  });

  it('puts rooms first in typed unified ordering with messages before actions', () => {
    expect(getCommandPaletteSectionOrder(parseCommandPaletteQuery('release'))).toEqual([
      'rooms',
      'threads',
      'users',
      'messages',
      'actions',
    ]);
  });

  it('returns a single section for scoped modes', () => {
    expect(getCommandPaletteSectionOrder(parseCommandPaletteQuery('t: hotfix'))).toEqual([
      'threads',
    ]);
    expect(getCommandPaletteSectionOrder(parseCommandPaletteQuery('# team'))).toEqual(['rooms']);
  });
});
