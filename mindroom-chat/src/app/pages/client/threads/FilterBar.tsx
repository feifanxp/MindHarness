import React, { ChangeEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Box, Button, Icon, Icons, Input, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_CROSS_ROOM_THREAD_FILTERS,
  type CrossRoomThreadActivityWindow,
  type CrossRoomThreadFilters,
  type CrossRoomThreadFiltersUpdate,
  type CrossRoomThreadResolvedFilter,
  type CrossRoomThreadScope,
} from '../../../mindroom/cross-room-threads/crossRoomThreadFilters';
import { FilterBarMobileSheet } from './FilterBarMobileSheet';
import { useLiquidGlass } from '../../../components/glass/liquid/useLiquidGlass';
import * as css from './FilterBar.css';

type FilterBarProps = {
  filters: CrossRoomThreadFilters;
  setFilters: (filters: CrossRoomThreadFiltersUpdate) => void;
};

type FilterControlsProps = FilterBarProps & {
  resetFilters: () => void;
};

const toCsv = (values: string[]): string => values.join(', ');
const fromCsv = (value: string): string[] =>
  Array.from(
    new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );

const areStringArraysEqual = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

function CsvFilterInput({
  ariaLabel,
  placeholder,
  values,
  onCommit,
}: {
  ariaLabel: string;
  placeholder: string;
  values: string[];
  onCommit: (values: string[]) => void;
}) {
  const serializedValues = toCsv(values);
  const [text, setText] = useState(serializedValues);
  const textRef = useRef(text);
  const committedValuesRef = useRef(values);

  textRef.current = text;

  useEffect(() => {
    committedValuesRef.current = values;
    if (areStringArraysEqual(fromCsv(textRef.current), values)) return;

    setText(serializedValues);
  }, [serializedValues, values]);

  const commitText = useCallback(
    (nextText: string) => {
      const parsedValues = fromCsv(nextText);
      if (areStringArraysEqual(parsedValues, committedValuesRef.current)) return;

      committedValuesRef.current = parsedValues;
      onCommit(parsedValues);
    },
    [onCommit]
  );

  useEffect(() => {
    const handle = window.setTimeout(() => {
      commitText(text);
    }, 250);

    return () => window.clearTimeout(handle);
  }, [commitText, text]);

  return (
    <Input
      className={css.CompactInput}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={text}
      onBlur={() => commitText(text)}
      onChange={(evt: ChangeEvent<HTMLInputElement>) => setText(evt.target.value)}
    />
  );
}

function LabeledSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const selectId = useId();

  return (
    <div className={css.Group}>
      <Text as="label" size="T200" priority="300" htmlFor={selectId}>
        {label}
      </Text>
      <select id={selectId} value={value} onChange={(evt) => onChange(evt.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function FilterControls({ filters, setFilters, resetFilters }: FilterControlsProps) {
  const { t } = useTranslation();
  const unreadId = useId();
  const attentionId = useId();
  const update = (patch: Partial<CrossRoomThreadFilters>) =>
    setFilters((current) => ({ ...current, ...patch }));

  return (
    <>
      <LabeledSelect
        label={t('thread.filters.scope')}
        value={filters.scope}
        options={[
          { value: 'involved', label: t('thread.filters.scopeInvolved') },
          { value: 'all', label: t('thread.filters.scopeAllRooms') },
        ]}
        onChange={(value) => update({ scope: value as CrossRoomThreadScope })}
      />
      <LabeledSelect
        label={t('thread.filters.status')}
        value={filters.resolved}
        options={[
          { value: 'all', label: t('thread.filters.statusAll') },
          { value: 'unresolved', label: t('thread.filters.statusUnresolved') },
          { value: 'resolved', label: t('thread.filters.statusResolved') },
        ]}
        onChange={(value) => update({ resolved: value as CrossRoomThreadResolvedFilter })}
      />
      <LabeledSelect
        label={t('thread.filters.activity')}
        value={filters.activityWindow}
        options={[
          { value: 'today', label: t('thread.filters.activityToday') },
          { value: '7d', label: t('thread.filters.activity7d') },
          { value: '30d', label: t('thread.filters.activity30d') },
          { value: 'all', label: t('thread.filters.activityAll') },
        ]}
        onChange={(value) => update({ activityWindow: value as CrossRoomThreadActivityWindow })}
      />
      <div className={css.Group}>
        <input
          id={unreadId}
          type="checkbox"
          checked={filters.unreadOnly}
          onChange={(evt) => update({ unreadOnly: evt.target.checked })}
        />
        <Text as="label" size="T200" htmlFor={unreadId}>
          {t('thread.filters.unread')}
        </Text>
      </div>
      <div className={css.Group}>
        <input
          id={attentionId}
          type="checkbox"
          checked={filters.hasAttention}
          onChange={(evt) => update({ hasAttention: evt.target.checked })}
        />
        <Text as="label" size="T200" htmlFor={attentionId}>
          {t('thread.filters.attention')}
        </Text>
      </div>
      <CsvFilterInput
        ariaLabel={t('thread.filters.roomIdsAria')}
        placeholder={t('thread.filters.roomIdsPlaceholder')}
        values={filters.roomIds}
        onCommit={(roomIds) => update({ roomIds })}
      />
      <CsvFilterInput
        ariaLabel={t('thread.filters.spaceIdsAria')}
        placeholder={t('thread.filters.spaceIdsPlaceholder')}
        values={filters.spaceIds}
        onCommit={(spaceIds) => update({ spaceIds })}
      />
      <CsvFilterInput
        ariaLabel={t('thread.filters.tagsIncludeAria')}
        placeholder={t('thread.filters.tagsPlaceholder')}
        values={filters.tag.include}
        onCommit={(include) =>
          setFilters((current) => ({ ...current, tag: { ...current.tag, include } }))
        }
      />
      <CsvFilterInput
        ariaLabel={t('thread.filters.tagsExcludeAria')}
        placeholder={t('thread.filters.excludeTagsPlaceholder')}
        values={filters.tag.exclude}
        onCommit={(exclude) =>
          setFilters((current) => ({ ...current, tag: { ...current.tag, exclude } }))
        }
      />
      <Button
        size="300"
        variant="Secondary"
        fill="Soft"
        onClick={resetFilters}
        outlined
        radii="300"
      >
        <Text size="B300">{t('thread.filters.clear')}</Text>
      </Button>
    </>
  );
}

export function FilterBar({ filters, setFilters }: FilterBarProps) {
  const glassRef = useLiquidGlass<HTMLDivElement>();
  const { t } = useTranslation();
  const [query, setQuery] = useState(filters.query);
  const [mobileOpen, setMobileOpen] = useState(false);
  const resetFilters = () => {
    setQuery(DEFAULT_CROSS_ROOM_THREAD_FILTERS.query);
    setFilters(DEFAULT_CROSS_ROOM_THREAD_FILTERS);
  };

  useEffect(() => {
    setQuery(filters.query);
  }, [filters.query]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (filters.query !== query) {
        setFilters((current) => (current.query === query ? current : { ...current, query }));
      }
    }, 250);

    return () => window.clearTimeout(handle);
  }, [filters.query, query, setFilters]);

  return (
    <Box ref={glassRef} className={css.Bar} data-testid="threads-filter-bar">
      <div className={css.Search}>
        <Input
          aria-label={t('thread.filters.search')}
          placeholder={t('thread.filters.search')}
          value={query}
          onChange={(evt: ChangeEvent<HTMLInputElement>) => setQuery(evt.target.value)}
        />
      </div>
      <div className={css.DesktopControls}>
        <FilterControls filters={filters} setFilters={setFilters} resetFilters={resetFilters} />
      </div>
      <Button
        className={css.MobileControls}
        size="300"
        onClick={() => setMobileOpen(true)}
        fill="Soft"
        outlined
        radii="300"
      >
        <Icon src={Icons.Filter} size="100" />
        <Text size="B300">{t('thread.filters.open')}</Text>
      </Button>
      <FilterBarMobileSheet open={mobileOpen} requestClose={() => setMobileOpen(false)}>
        <FilterControls filters={filters} setFilters={setFilters} resetFilters={resetFilters} />
      </FilterBarMobileSheet>
    </Box>
  );
}
