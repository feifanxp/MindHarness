import Fuse, { type FuseOptionKey } from 'fuse.js';
import type {
  CommandPaletteActionItem,
  CommandPaletteRoomItem,
  CommandPaletteThreadItem,
  CommandPaletteUserItem,
} from './commandPaletteTypes';

const BOOST_WEIGHT = 0.05;

type SearchableCommandPaletteItem = {
  id: string;
  boost?: number;
  sortRank?: number;
};
type SearchableCommandPaletteItems = readonly SearchableCommandPaletteItem[];

export type CommandPaletteSearchConfig<T> = {
  keys: FuseOptionKey<T>[];
  threshold: number;
  limit: number;
};

type SearchCommandPaletteSectionOptions<T extends SearchableCommandPaletteItem> = {
  items: readonly T[];
  query: string;
  config: CommandPaletteSearchConfig<T>;
  getBoost?: (item: T) => number;
  getSortRank?: (item: T) => number;
};

const sectionFuseCache = new WeakMap<SearchableCommandPaletteItems, Fuse<SearchableCommandPaletteItem>>();

const compareNumber = (left: number, right: number): number => {
  if (left === right) return 0;
  return left > right ? -1 : 1;
};

const compareId = (left: string, right: string): number => left.localeCompare(right);

const getItemBoost = <T extends SearchableCommandPaletteItem>(
  item: T,
  getBoost?: (entry: T) => number
): number => getBoost?.(item) ?? item.boost ?? 0;

const getItemSortRank = <T extends SearchableCommandPaletteItem>(
  item: T,
  getSortRank?: (entry: T) => number
): number => getSortRank?.(item) ?? item.sortRank ?? 0;

const getSectionFuse = <T extends SearchableCommandPaletteItem>(
  items: readonly T[],
  config: CommandPaletteSearchConfig<T>
): Fuse<T> => {
  const cachedFuse = sectionFuseCache.get(items as SearchableCommandPaletteItems);
  if (cachedFuse) {
    return cachedFuse as unknown as Fuse<T>;
  }

  const { limit, ...fuseConfig } = config;
  const fuse = new Fuse([...items], {
    ...fuseConfig,
    ignoreLocation: true,
    includeScore: true,
  });
  sectionFuseCache.set(
    items as SearchableCommandPaletteItems,
    fuse as unknown as Fuse<SearchableCommandPaletteItem>
  );

  return fuse;
};

export const commandPaletteSearchConfig = {
  actions: {
    keys: ['title', 'keywords', 'description'],
    threshold: 0.25,
    limit: 6,
  } satisfies CommandPaletteSearchConfig<CommandPaletteActionItem>,
  rooms: {
    keys: ['name', 'canonicalAlias', 'topic', 'parentNames'],
    threshold: 0.3,
    limit: 8,
  } satisfies CommandPaletteSearchConfig<CommandPaletteRoomItem>,
  users: {
    keys: ['displayName', 'userId', 'localpart', 'dmRoomName'],
    threshold: 0.35,
    limit: 6,
  } satisfies CommandPaletteSearchConfig<CommandPaletteUserItem>,
  threads: {
    keys: ['summaryText', 'roomName', 'participantNames', 'tags'],
    threshold: 0.4,
    limit: 8,
  } satisfies CommandPaletteSearchConfig<CommandPaletteThreadItem>,
};

export const searchCommandPaletteSection = <T extends SearchableCommandPaletteItem>({
  items,
  query,
  config,
  getBoost,
  getSortRank,
}: SearchCommandPaletteSectionOptions<T>): T[] => {
  const trimmedQuery = query.trim();

  if (trimmedQuery.length === 0) {
    return [...items]
      .sort(
        (left, right) =>
          compareNumber(getItemSortRank(left, getSortRank), getItemSortRank(right, getSortRank)) ||
          compareNumber(getItemBoost(left, getBoost), getItemBoost(right, getBoost)) ||
          compareId(left.id, right.id)
      )
      .slice(0, config.limit);
  }

  const { limit } = config;
  const fuse = getSectionFuse(items, config);
  const results = fuse.search(trimmedQuery);

  const boosts = results.map((result) => getItemBoost(result.item, getBoost));
  const maxBoost = Math.max(...boosts, 0);
  const minBoost = Math.min(...boosts, 0);

  return results
    .map((result) => {
      const boost = getItemBoost(result.item, getBoost);
      const normalizedBoost =
        maxBoost === minBoost ? 0 : (boost - minBoost) / (maxBoost - minBoost);

      return {
        item: result.item,
        score: (result.score ?? 1) - normalizedBoost * BOOST_WEIGHT,
      };
    })
    .sort(
      (left, right) =>
        (left.score - right.score) ||
        compareNumber(
          getItemSortRank(left.item, getSortRank),
          getItemSortRank(right.item, getSortRank)
        ) ||
        compareId(left.item.id, right.item.id)
    )
    .slice(0, limit)
    .map((result) => result.item);
};
