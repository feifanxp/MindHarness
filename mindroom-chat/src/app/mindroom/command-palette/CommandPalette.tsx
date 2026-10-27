import { Icon, Icons } from 'folds';
import { useTranslation } from 'react-i18next';
import { type TFunction } from 'i18next';
import React, {
  ChangeEventHandler,
  KeyboardEventHandler,
  useEffect,
  useId,
  useRef,
  useMemo,
  useState,
} from 'react';
import { getCommandPaletteSectionOrder, parseCommandPaletteQuery } from './commandPaletteQuery';
import type { CommandPaletteSource, ExecutableCommandPaletteItem } from './commandPaletteItems';
import { commandPaletteSearchConfig, searchCommandPaletteSection } from './commandPaletteSearch';
import {
  CommandPaletteList,
  getCommandPaletteOptionId,
  type CommandPaletteListSection,
} from './CommandPaletteList';
import * as css from './CommandPalette.css';
import { getCommandPaletteShortcutLabel } from './commandPaletteShortcut';
import { COMMAND_PALETTE_PREFIX_HINTS, type CommandPalettePrefix } from './commandPaletteTypes';
import type { CommandPaletteParsedQuery, CommandPaletteRoomItem } from './commandPaletteTypes';

type CommandPaletteProps = {
  requestClose: () => void;
  source: CommandPaletteSource;
  mobileSheet?: boolean;
};

const SECTION_TITLE_KEYS = {
  actions: 'commandPalette.sections.actions',
  threads: 'commandPalette.sections.threads',
  rooms: 'commandPalette.sections.rooms',
  users: 'commandPalette.sections.users',
  messages: 'commandPalette.sections.messages',
} as const satisfies Record<CommandPaletteListSection['id'], string>;

const getSectionTitle = (
  sectionId: CommandPaletteListSection['id'],
  parsedQuery: CommandPaletteParsedQuery,
  t: TFunction
): string => {
  if (sectionId === 'rooms' && parsedQuery.mode === 'spaces') {
    return t('commandPalette.sections.spaces');
  }

  return t(SECTION_TITLE_KEYS[sectionId]);
};

const getSectionItems = ({
  sectionId,
  parsedQuery,
  source,
  spaceItems,
}: {
  sectionId: CommandPaletteListSection['id'];
  parsedQuery: CommandPaletteParsedQuery;
  source: CommandPaletteSource;
  spaceItems: readonly (CommandPaletteRoomItem & { onSelect?: () => void })[];
}): ExecutableCommandPaletteItem[] => {
  switch (sectionId) {
    case 'actions':
      return searchCommandPaletteSection({
        items: source.actions,
        query:
          parsedQuery.mode === 'actions' || parsedQuery.mode === 'all'
            ? parsedQuery.searchText
            : '',
        config: commandPaletteSearchConfig.actions,
      });
    case 'threads':
      return searchCommandPaletteSection({
        items: source.threads,
        query:
          parsedQuery.mode === 'threads' || parsedQuery.mode === 'all'
            ? parsedQuery.searchText
            : '',
        config: commandPaletteSearchConfig.threads,
      });
    case 'rooms': {
      let items = source.rooms;
      if (parsedQuery.mode === 'spaces') items = spaceItems;
      // The starter list is for switching rooms; spaces still match by name or with `*`.
      else if (!parsedQuery.searchText) items = source.rooms.filter((item) => item.kind === 'room');
      return searchCommandPaletteSection({
        items,
        query:
          parsedQuery.mode === 'rooms' ||
          parsedQuery.mode === 'spaces' ||
          parsedQuery.mode === 'all'
            ? parsedQuery.searchText
            : '',
        config: commandPaletteSearchConfig.rooms,
      });
    }
    case 'users': {
      const hasSearchText = parsedQuery.searchText.length > 0;
      return searchCommandPaletteSection({
        items: source.getUsers({
          exhaustive: hasSearchText,
          includeRelatedRooms: parsedQuery.mode === 'users' || hasSearchText,
        }),
        query:
          parsedQuery.mode === 'users' || parsedQuery.mode === 'all' ? parsedQuery.searchText : '',
        config: commandPaletteSearchConfig.users,
      });
    }
    default:
      return source.getMessages(parsedQuery.showMessages ? parsedQuery.searchText : '');
  }
};

const buildVisibleSections = ({
  parsedQuery,
  sectionOrder,
  source,
  spaceItems,
  t,
}: {
  parsedQuery: CommandPaletteParsedQuery;
  sectionOrder: readonly CommandPaletteListSection['id'][];
  source: CommandPaletteSource;
  spaceItems: readonly (CommandPaletteRoomItem & { onSelect?: () => void })[];
  t: TFunction;
}): CommandPaletteListSection[] =>
  sectionOrder
    .map((sectionId) => {
      const items = getSectionItems({
        sectionId,
        parsedQuery,
        source,
        spaceItems,
      });
      if (items.length === 0) return undefined;

      return {
        id: sectionId,
        title: getSectionTitle(sectionId, parsedQuery, t),
        items,
      } satisfies CommandPaletteListSection;
    })
    .filter((section): section is CommandPaletteListSection => section !== undefined);

const getResultCountLabel = (
  sections: readonly CommandPaletteListSection[],
  t: TFunction
): string => {
  const count = sections.reduce((total, section) => total + section.items.length, 0);
  if (count === 0) return t('commandPalette.noResults');
  return t('commandPalette.resultCount', { count });
};

const PREFIX_LABEL_KEYS = {
  '>': 'commandPalette.sections.actions',
  '#': 'commandPalette.sections.rooms',
  '@': 'commandPalette.sections.users',
  't:': 'commandPalette.sections.threads',
  '*': 'commandPalette.sections.spaces',
} as const satisfies Record<CommandPalettePrefix, string>;

export function CommandPalette({ requestClose, source, mobileSheet = false }: CommandPaletteProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [literalSearch, setLiteralSearch] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const parsedQuery = useMemo<CommandPaletteParsedQuery>(() => {
    if (!literalSearch) return parseCommandPaletteQuery(query);
    const searchText = query.trim();
    return { raw: query, mode: 'all', searchText, showMessages: searchText.length > 0 };
  }, [query, literalSearch]);
  const sectionOrder = useMemo(() => getCommandPaletteSectionOrder(parsedQuery), [parsedQuery]);
  const spaceItems = useMemo(
    () => source.rooms.filter((item) => item.kind === 'space'),
    [source.rooms]
  );

  const visibleSections = useMemo(
    () =>
      buildVisibleSections({
        parsedQuery,
        sectionOrder,
        source,
        spaceItems,
        t,
      }),
    [parsedQuery, sectionOrder, source, spaceItems, t]
  );
  const visibleItems = useMemo(
    () => visibleSections.flatMap((section) => section.items),
    [visibleSections]
  );

  useEffect(() => {
    setSelectedIndex(0);
    if (resultsRef.current) resultsRef.current.scrollTop = 0;
  }, [query, literalSearch]);

  useEffect(() => {
    if (selectedIndex < visibleItems.length) return;
    setSelectedIndex(Math.max(visibleItems.length - 1, 0));
  }, [selectedIndex, visibleItems.length]);

  const selectedItem = visibleItems[selectedIndex];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleChange: ChangeEventHandler<HTMLInputElement> = (event) => {
    setQuery(event.currentTarget.value);
    if (!event.currentTarget.value.trim()) setLiteralSearch(false);
  };

  const handleSelect = (item: ExecutableCommandPaletteItem) => {
    item.onSelect?.();
    setQuery('');
    requestClose();
  };

  const handleKeyDown: KeyboardEventHandler<HTMLInputElement> = (event) => {
    if (event.nativeEvent?.isComposing || event.keyCode === 229) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (visibleItems.length === 0) return;
      setSelectedIndex((index) => (index + 1) % visibleItems.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (visibleItems.length === 0) return;
      setSelectedIndex((index) => (index - 1 + visibleItems.length) % visibleItems.length);
      return;
    }

    if (event.key === 'Enter' && selectedItem) {
      event.preventDefault();
      handleSelect(selectedItem);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation?.();
      setQuery('');
      requestClose();
    }
  };

  const shortcutLabel = getCommandPaletteShortcutLabel();

  const changeFilter = (prefix?: CommandPalettePrefix) => {
    // Keep a pasted Matrix ID literal when removing an explicit category prefix.
    setLiteralSearch(!prefix && !!parseCommandPaletteQuery(parsedQuery.searchText).prefix);
    setQuery(prefix ? prefix + ' ' + parsedQuery.searchText : parsedQuery.searchText);
    inputRef.current?.focus();
  };
  const filters = [undefined, ...COMMAND_PALETTE_PREFIX_HINTS] as const;

  return (
    <div
      className={css.Palette}
      style={{ paddingBottom: mobileSheet ? 'env(safe-area-inset-bottom, 0px)' : undefined }}
    >
      <div className={css.Search}>
        <Icon src={Icons.Search} size="300" />
        <input
          ref={inputRef}
          dir={query ? 'auto' : undefined}
          className={css.Input}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={
            selectedItem ? getCommandPaletteOptionId(listId, selectedItem.id) : undefined
          }
          aria-label={t('commandPalette.inputAria')}
          placeholder={t('commandPalette.placeholder')}
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className={css.Close}
          aria-label={t('commandPalette.closeAria')}
          onClick={requestClose}
        >
          {mobileSheet ? <Icon src={Icons.Cross} size="200" /> : <kbd className={css.Key}>esc</kbd>}
        </button>
      </div>
      <div className={css.Filters} role="group" aria-label={t('commandPalette.filterLabel')}>
        {filters.map((prefix) => (
          <button
            type="button"
            key={prefix ?? 'all'}
            className={css.Filter}
            aria-label={prefix ? t(PREFIX_LABEL_KEYS[prefix]) : t('commandPalette.all')}
            aria-pressed={parsedQuery.prefix === prefix}
            onClick={() => changeFilter(prefix)}
          >
            {prefix ? t(PREFIX_LABEL_KEYS[prefix]) : t('commandPalette.all')}
            {prefix && (
              <span className={css.Prefix} aria-hidden="true">
                {prefix}
              </span>
            )}
          </button>
        ))}
      </div>
      <div ref={resultsRef} className={css.Results}>
        <CommandPaletteList
          id={listId}
          label={t('commandPalette.resultsLabel')}
          sections={visibleSections}
          selectedItemId={selectedItem?.id}
          onHighlight={(itemId) =>
            setSelectedIndex(visibleItems.findIndex((item) => item.id === itemId))
          }
          onSelect={handleSelect}
        />
        {visibleSections.length === 0 && (
          <div className={css.Empty}>
            <Icon src={Icons.Search} size="400" />
            <span className={css.EmptyTitle}>{t('commandPalette.noResults')}</span>
            <span className={css.EmptyDescription}>{t('commandPalette.emptyDescription')}</span>
            <button
              type="button"
              className={css.Filter}
              aria-label={t('commandPalette.clearSearch')}
              onClick={() => {
                setQuery('');
                setLiteralSearch(false);
                inputRef.current?.focus();
              }}
            >
              {t('commandPalette.clearSearch')}
            </button>
          </div>
        )}
      </div>
      <div className={css.Footer}>
        <div className={css.KeyboardHints}>
          <span className={css.Hint}>
            <kbd className={css.Key}>↑</kbd>
            <kbd className={css.Key}>↓</kbd> {t('commandPalette.navigate')}
          </span>
          <span className={css.Hint}>
            <kbd className={css.Key}>↵</kbd> {t('commandPalette.select')}
          </span>
          <span className={css.Hint}>
            <kbd className={css.Key}>{shortcutLabel}</kbd>
          </span>
        </div>
        <span role="status" aria-live="polite">
          {getResultCountLabel(visibleSections, t)}
        </span>
      </div>
    </div>
  );
}
