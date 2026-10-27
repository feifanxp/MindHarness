import { describe, expect, it } from 'vitest';
import type { ThreadFilterState } from './roomThreadOverviewModel';

const makeDefaultState = (overrides?: Partial<ThreadFilterState>): ThreadFilterState => ({
  resolved: 'any',
  streaming: 'any',
  scheduled: 'any',
  unread: 'any',
  idle: 'any',
  sortBy: 'natural',
  sortDirection: 'desc',
  tags: new Map(),
  freeText: '',
  unsupportedQuery: '',
  statusMode: 'and',
  ...overrides,
});

describe('roomThreadOverviewModel', () => {
  describe('filter state serialization', () => {
    it('round-trips the default filter state', async () => {
      const {
        createDefaultThreadFilterState,
        deserializeThreadFilterState,
        serializeThreadFilterState,
      } = await import('./roomThreadOverviewModel');

      const state = createDefaultThreadFilterState();
      expect(serializeThreadFilterState(state)).toEqual({
        v: 2,
        resolved: 'any',
        streaming: 'any',
        scheduled: 'any',
        unread: 'any',
        idle: 'any',
        sortBy: 'lastReply',
        sortDirection: 'desc',
        tags: {},
        freeText: '',
        unsupportedQuery: '',
        statusMode: 'and',
      });
      expect(deserializeThreadFilterState(serializeThreadFilterState(state))).toEqual(state);
    });

    it('round-trips non-default filters, sort state, tags, search, and OR mode', async () => {
      const { deserializeThreadFilterState, serializeThreadFilterState } = await import(
        './roomThreadOverviewModel'
      );
      const state = makeDefaultState({
        resolved: 'include',
        streaming: 'exclude',
        scheduled: 'include',
        unread: 'exclude',
        idle: 'include',
        sortBy: 'lastReply',
        sortDirection: 'asc',
        freeText: 'hello',
        statusMode: 'or',
        tags: new Map([
          ['blocked', 'exclude'],
          ['needs-review', 'include'],
        ]),
      });

      expect(deserializeThreadFilterState(serializeThreadFilterState(state))).toEqual(state);
    });

    it('sanitizes malformed persisted filter state', async () => {
      const { deserializeThreadFilterState } = await import('./roomThreadOverviewModel');

      const result = deserializeThreadFilterState({
        v: 1,
        resolved: 'bad',
        streaming: 'include',
        scheduled: 'exclude',
        unread: 123,
        idle: 'any',
        sortBy: 'bad',
        sortDirection: 'bad',
        tags: {
          priority: 'include',
          ignored: 'any',
          blocked: 'exclude',
          invalid: 'wat',
        },
        searchQuery: 42,
        statusMode: 'wat',
      });

      expect(result).toEqual({
        resolved: 'any',
        streaming: 'include',
        scheduled: 'exclude',
        unread: 'any',
        idle: 'any',
        sortBy: 'lastReply',
        sortDirection: 'desc',
        tags: new Map([
          ['blocked', 'exclude'],
          ['priority', 'include'],
        ]),
        freeText: '',
        unsupportedQuery: '',
        statusMode: 'and',
      });
    });
  });

  describe('filter state helpers', () => {
    it('cycles status filters and resets status mode to AND', async () => {
      const { updateThreadFilterKey } = await import('./roomThreadOverviewModel');

      expect(
        updateThreadFilterKey(makeDefaultState({ statusMode: 'or' }), 'resolved')
      ).toMatchObject({
        resolved: 'include',
        statusMode: 'and',
      });
      expect(
        updateThreadFilterKey(makeDefaultState({ resolved: 'include' }), 'resolved').resolved
      ).toBe('exclude');
      expect(
        updateThreadFilterKey(makeDefaultState({ resolved: 'exclude' }), 'resolved').resolved
      ).toBe('any');
    });

    it('cycles natural/last-reply sort modes in the UI order', async () => {
      const { cycleSortMode } = await import('./roomThreadOverviewModel');

      expect(cycleSortMode(makeDefaultState({ sortBy: 'natural' }))).toEqual({
        sortBy: 'lastReply',
        sortDirection: 'desc',
      });
      expect(
        cycleSortMode(makeDefaultState({ sortBy: 'lastReply', sortDirection: 'desc' }))
      ).toEqual({
        sortBy: 'lastReply',
        sortDirection: 'asc',
      });
      expect(
        cycleSortMode(makeDefaultState({ sortBy: 'lastReply', sortDirection: 'asc' }))
      ).toEqual({
        sortBy: 'natural',
        sortDirection: 'desc',
      });
    });

    it('detects active/default room-overview states', async () => {
      const {
        createDefaultThreadFilterState,
        hasActiveThreadFilters,
        isDefaultThreadFilterState,
        isOrModeStatusChip,
        isRoomThreadOverviewActive,
        resetThreadFilterState,
      } = await import('./roomThreadOverviewModel');

      const defaultState = createDefaultThreadFilterState();
      expect(isDefaultThreadFilterState(defaultState)).toBe(true);
      expect(hasActiveThreadFilters(defaultState)).toBe(false);
      expect(isRoomThreadOverviewActive(undefined, defaultState)).toBe(true);
      expect(isRoomThreadOverviewActive('$thread', defaultState)).toBe(false);
      expect(resetThreadFilterState()).toEqual(defaultState);

      const workingState = makeDefaultState({
        streaming: 'include',
        scheduled: 'include',
        statusMode: 'or',
      });
      expect(hasActiveThreadFilters(workingState)).toBe(true);
      expect(isOrModeStatusChip(workingState, 'streaming')).toBe(true);
      expect(isOrModeStatusChip(workingState, 'resolved')).toBe(false);
    });
  });

  describe('tag filter helpers', () => {
    it('cycles, adds, removes, and counts tag filters', async () => {
      const { addTagFilter, collectAvailableRoomTags, cycleTagFilter, removeTagFilter } =
        await import('./roomThreadOverviewModel');

      const defaultState = makeDefaultState();
      const included = cycleTagFilter(defaultState, 'priority');
      expect(included.tags.get('priority')).toBe('include');
      const excluded = cycleTagFilter(included, 'priority');
      expect(excluded.tags.get('priority')).toBe('exclude');
      const cleared = cycleTagFilter(excluded, 'priority');
      expect(cleared.tags.has('priority')).toBe(false);

      const added = addTagFilter(defaultState, 'blocked');
      expect(added.tags.get('blocked')).toBe('include');
      expect(removeTagFilter(added, 'blocked').tags.has('blocked')).toBe(false);

      expect(
        collectAvailableRoomTags(
          new Map([
            ['$a', { tags: { resolved: {}, priority: {} } }],
            ['$b', { tags: { blocked: {}, priority: {} } }],
            ['$c', { tags: null }],
          ])
        )
      ).toEqual(['blocked', 'priority', 'resolved']);
    });
  });

  describe('thread ordering helpers', () => {
    it('applies frozen order while preserving new live ids', async () => {
      const { applyFrozenThreadOrder } = await import('./roomThreadOverviewModel');

      expect(applyFrozenThreadOrder(['$c', '$missing', '$a'], ['$a', '$b', '$c', '$d'])).toEqual([
        '$c',
        '$a',
        '$b',
        '$d',
      ]);
    });

    it('creates stable sort-control signatures', async () => {
      const { createThreadSortControlSignature } = await import('./roomThreadOverviewModel');
      const state = makeDefaultState({
        tags: new Map([
          ['z', 'include'],
          ['a', 'exclude'],
        ]),
      });

      expect(createThreadSortControlSignature({ state, searchQuery: 'needle' })).toContain(
        '"searchQuery":"needle"'
      );
      expect(createThreadSortControlSignature({ state })).toBe(
        createThreadSortControlSignature({
          state: makeDefaultState({
            tags: new Map([
              ['a', 'exclude'],
              ['z', 'include'],
            ]),
          }),
        })
      );
    });
  });

  describe('filter presets', () => {
    it('materializes the working preset as streaming OR scheduled and serializes it', async () => {
      const { FILTER_PRESETS, applyPreset } = await import('./roomThreadOverviewModel');
      const { serializeThreadFilterQuery } = await import('./threadFilterDsl');
      const workingPreset = FILTER_PRESETS.find((preset) => preset.id === 'working');
      if (!workingPreset) throw new Error('working preset missing');

      const state = applyPreset(makeDefaultState(), workingPreset);

      expect(state).toMatchObject({
        streaming: 'include',
        scheduled: 'include',
        statusMode: 'or',
      });
      expect(serializeThreadFilterQuery(state)).toBe('is:streaming OR is:scheduled');
    });

    it('resets all filters for the all preset', async () => {
      const { FILTER_PRESETS, applyPreset } = await import('./roomThreadOverviewModel');
      const allPreset = FILTER_PRESETS.find((preset) => preset.id === 'all');
      if (!allPreset) throw new Error('all preset missing');

      const state = applyPreset(
        makeDefaultState({
          resolved: 'include',
          tags: new Map([['priority', 'include']]),
          freeText: 'needle',
          unsupportedQuery: 'tag:a OR tag:b',
        }),
        allPreset
      );

      expect(state.tags.size).toBe(0);
      expect(state.freeText).toBe('');
      expect(state.unsupportedQuery).toBe('');
      expect(state.resolved).toBe('any');
    });
  });

  describe('simplifyThreadFilterState', () => {
    it('keeps only unresolved and sorting dimensions', async () => {
      const { createDefaultThreadFilterState, simplifyThreadFilterState } = await import(
        './roomThreadOverviewModel'
      );

      const advanced = makeDefaultState({
        resolved: 'exclude',
        streaming: 'include',
        unread: 'exclude',
        sortBy: 'natural',
        statusMode: 'or',
        freeText: 'needle',
        unsupportedQuery: 'tag:a OR tag:b',
        tags: new Map([['priority', 'include']]),
      });

      expect(simplifyThreadFilterState(advanced)).toEqual({
        ...createDefaultThreadFilterState(),
        resolved: 'exclude',
        sortBy: 'natural',
        sortDirection: 'desc',
      });
    });

    it('preserves last-reply sort direction', async () => {
      const { simplifyThreadFilterState } = await import('./roomThreadOverviewModel');

      expect(
        simplifyThreadFilterState(makeDefaultState({ sortBy: 'lastReply', sortDirection: 'asc' }))
      ).toMatchObject({ sortBy: 'lastReply', sortDirection: 'asc' });
    });

    it('maps every non-exclude resolved value to showing all threads', async () => {
      const { createDefaultThreadFilterState, simplifyThreadFilterState } = await import(
        './roomThreadOverviewModel'
      );

      const naturalSortState = {
        ...createDefaultThreadFilterState(),
        sortBy: 'natural' as const,
        sortDirection: 'desc' as const,
      };
      expect(simplifyThreadFilterState(makeDefaultState({ resolved: 'include' }))).toEqual(
        naturalSortState
      );
      expect(simplifyThreadFilterState(makeDefaultState({ resolved: 'any' }))).toEqual(
        naturalSortState
      );
    });

    it('keeps the unresolved projection canonical without a DSL round trip', async () => {
      const { simplifyThreadFilterState } = await import('./roomThreadOverviewModel');
      const { serializeThreadFilterQuery } = await import('./threadFilterDsl');

      const projected = simplifyThreadFilterState(makeDefaultState({ resolved: 'exclude' }));
      expect(projected.resolved).toBe('exclude');
      expect(serializeThreadFilterQuery(projected)).toBe('-is:resolved');

      const projectedOff = simplifyThreadFilterState(makeDefaultState({ resolved: 'any' }));
      expect(projectedOff.resolved).toBe('any');
      expect(serializeThreadFilterQuery(projectedOff)).toBe('');
    });
  });

  describe('simplifyAgentlessThreadFilterState', () => {
    it('keeps only text search and sorting from the full toolbar state', async () => {
      const { simplifyAgentlessThreadFilterState } = await import('./roomThreadOverviewModel');

      const projected = simplifyAgentlessThreadFilterState(
        makeDefaultState({
          resolved: 'include',
          streaming: 'exclude',
          scheduled: 'include',
          unread: 'exclude',
          idle: 'include',
          sortBy: 'lastReply',
          sortDirection: 'asc',
          statusMode: 'or',
          tags: new Map([['priority', 'include']]),
          freeText: 'needle',
          unsupportedQuery: 'from:alice',
        })
      );

      expect(projected).toEqual({
        ...makeDefaultState(),
        sortBy: 'lastReply',
        sortDirection: 'asc',
        freeText: 'needle',
        unsupportedQuery: 'from:alice',
      });
    });
  });

  describe('simplifyAgentlessSimpleThreadFilterState', () => {
    it('keeps sorting while clearing every hidden filter dimension', async () => {
      const { simplifyAgentlessSimpleThreadFilterState } = await import(
        './roomThreadOverviewModel'
      );

      expect(
        simplifyAgentlessSimpleThreadFilterState(
          makeDefaultState({
            resolved: 'exclude',
            sortBy: 'lastReply',
            sortDirection: 'asc',
            freeText: 'hidden search',
            tags: new Map([['priority', 'include']]),
          })
        )
      ).toEqual({
        ...makeDefaultState(),
        sortBy: 'lastReply',
        sortDirection: 'asc',
      });
    });
  });
});
