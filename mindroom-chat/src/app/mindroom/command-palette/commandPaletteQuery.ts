import {
  COMMAND_PALETTE_PREFIX_HINTS,
  type CommandPaletteParsedQuery,
  type CommandPalettePrefix,
  type CommandPaletteSectionId,
} from './commandPaletteTypes';

// Switching rooms is the most common reason to open the palette, so rooms lead
// both orders.
const EMPTY_UNIFIED_SECTION_ORDER: readonly CommandPaletteSectionId[] = [
  'rooms',
  'threads',
  'actions',
  'users',
];

const TYPED_UNIFIED_SECTION_ORDER: readonly CommandPaletteSectionId[] = [
  'rooms',
  'threads',
  'users',
  'messages',
  'actions',
];

const resolveQueryMode = (
  prefix: CommandPalettePrefix | undefined
): CommandPaletteParsedQuery['mode'] => {
  if (prefix === '>') return 'actions';
  if (prefix === '#') return 'rooms';
  if (prefix === '@') return 'users';
  if (prefix === '*') return 'spaces';
  if (prefix === 't:') return 'threads';
  return 'all';
};

const getPrefix = (value: string): CommandPalettePrefix | undefined =>
  COMMAND_PALETTE_PREFIX_HINTS.find((prefix) => value.startsWith(prefix));

export const parseCommandPaletteQuery = (value: string): CommandPaletteParsedQuery => {
  const leadingTrimmedValue = value.trimStart();
  const prefix = getPrefix(leadingTrimmedValue);
  const searchText = prefix
    ? leadingTrimmedValue.slice(prefix.length).trim()
    : leadingTrimmedValue.trim();
  const mode = resolveQueryMode(prefix);

  return {
    raw: value,
    prefix,
    mode,
    searchText,
    showMessages: mode === 'all' && searchText.length > 0,
  };
};

export const getCommandPaletteSectionOrder = (
  query: CommandPaletteParsedQuery
): readonly CommandPaletteSectionId[] => {
  if (query.mode === 'actions') return ['actions'];
  if (query.mode === 'rooms' || query.mode === 'spaces') return ['rooms'];
  if (query.mode === 'users') return ['users'];
  if (query.mode === 'threads') return ['threads'];
  if (query.searchText.length === 0) return EMPTY_UNIFIED_SECTION_ORDER;
  return TYPED_UNIFIED_SECTION_ORDER;
};
