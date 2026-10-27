import FocusTrap from 'focus-trap-react';
import { Overlay, OverlayBackdrop, PopOut, Spinner } from 'folds';
import { Room } from 'matrix-js-sdk';
import {
  IconCheck,
  IconChevronDown,
  IconRefresh,
  IconRotateClockwise,
  IconSearch,
  IconX,
} from '@tabler/icons-react';
import React, {
  ChangeEventHandler,
  KeyboardEventHandler,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { usePreventScroll } from 'react-aria';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { stopPropagation } from '../../utils/keyboard';
import { PageScroll } from '../../components/page';
import { Header, Modal, Surface } from '../../components/glass/GlassPrimitives';
import type { ModelCatalogEntry } from './modelProtocol';
import { ModelIcon } from './ModelIcon';
import { useModelPicker, type ModelPickerState } from './useModelPicker';
import * as css from './ModelPicker.css';

type ModelPickerPanelProps = {
  state: ModelPickerState;
  mobile: boolean;
  requestClose: () => void;
  onCommand: () => void;
};

const modelMatches = (model: ModelCatalogEntry, query: string): boolean =>
  `${model.display_name} ${model.key} ${model.provider}`.toLocaleLowerCase().includes(query);

const optionId = (listId: string, key: string): string => `${listId}-${encodeURIComponent(key)}`;
type PickerItem = { kind: 'default' } | { kind: 'model'; model: ModelCatalogEntry };
const pickerItemId = (item: PickerItem): string =>
  item.kind === 'default' ? 'default-action' : `model:${item.model.key}`;

function ModelPickerPanel({ state, mobile, requestClose, onCommand }: ModelPickerPanelProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const defaultVisible =
    !normalizedQuery ||
    `${t('mindroomUi.models.modelPicker.useRoomDefault')} ${t(
      'mindroomUi.models.modelPicker.roomDefaultDescription'
    )}`
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  const visibleModels = useMemo(
    () => state.models.filter((model) => modelMatches(model, normalizedQuery)),
    [state.models, normalizedQuery]
  );
  const groups = useMemo(() => {
    const grouped = new Map<string, ModelCatalogEntry[]>();
    visibleModels.forEach((model) => {
      grouped.set(model.provider, [...(grouped.get(model.provider) ?? []), model]);
    });
    return [...grouped];
  }, [visibleModels]);
  const items = useMemo(
    () => [
      ...(defaultVisible ? ([{ kind: 'default' }] satisfies PickerItem[]) : []),
      ...groups.flatMap(([, models]) => models.map((model) => ({ kind: 'model' as const, model }))),
    ],
    [defaultVisible, groups]
  );
  const activeItem = items[activeIndex];
  const mutationsDisabled = !state.canMutate;
  const inheritedModels = useMemo(() => {
    const labels = new Map(state.models.map((model) => [model.key, model.display_name]));
    return state.inherited
      .map(({ entity, model }) => `${entity}: ${labels.get(model) ?? model}`)
      .join(', ');
  }, [state.inherited, state.models]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActiveIndex(0);
    if (resultsRef.current) resultsRef.current.scrollTop = 0;
  }, [query]);

  useEffect(() => {
    if (activeIndex < items.length) return;
    setActiveIndex(Math.max(items.length - 1, 0));
  }, [activeIndex, items.length]);

  useEffect(() => {
    document
      .getElementById(activeItem ? optionId(listId, pickerItemId(activeItem)) : '')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [activeItem, listId]);

  const selectItem = (item: PickerItem) => {
    if (mutationsDisabled) return;
    onCommand();
    if (item.kind === 'default') state.resetToRoomDefault();
    else state.selectModel(item.model.key);
  };

  const handleKeyDown: KeyboardEventHandler<HTMLInputElement> = (event) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (items.length) setActiveIndex((index) => (index + 1) % items.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (items.length) setActiveIndex((index) => (index - 1 + items.length) % items.length);
      return;
    }
    if (event.key === 'Enter' && activeItem) {
      event.preventDefault();
      selectItem(activeItem);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      requestClose();
    }
  };

  const handleQuery: ChangeEventHandler<HTMLInputElement> = (event) => {
    setQuery(event.currentTarget.value);
  };

  return (
    <Surface
      appearance={mobile ? 'inherit' : 'glass'}
      level="overlay"
      variant="Surface"
      className={`${css.Panel} ${mobile ? css.MobilePanel : ''}`}
      role="dialog"
      aria-labelledby={`${listId}-title`}
      data-model-picker-sheet={mobile ? 'mobile' : 'desktop'}
    >
      <PageScroll
        scrollRef={resultsRef}
        scrollbarTabIndex={-1}
        header={
          <Header as="div" className={css.Controls}>
            <div className={css.Header}>
              <div className={css.HeaderText}>
                <span id={`${listId}-title`} className={css.Title}>
                  {t('mindroomUi.models.modelPicker.modelForThread')}
                </span>
                <span className={css.Subtitle}>
                  {t('mindroomUi.models.modelPicker.appliesToThread')}
                </span>
              </div>
              <button
                type="button"
                className={css.IconButton}
                aria-label={t('mindroomUi.models.modelPicker.close')}
                onClick={requestClose}
              >
                <IconX size={18} />
              </button>
            </div>

            <div className={css.SearchRow}>
              <IconSearch size={16} aria-hidden="true" />
              <input
                ref={inputRef}
                className={css.SearchInput}
                role="searchbox"
                aria-label={t('mindroomUi.models.modelPicker.search')}
                aria-controls={listId}
                aria-activedescendant={
                  activeItem ? optionId(listId, pickerItemId(activeItem)) : undefined
                }
                autoComplete="off"
                spellCheck={false}
                value={query}
                onChange={handleQuery}
                onKeyDown={handleKeyDown}
              />
              <button
                type="button"
                className={css.IconButton}
                aria-label={t('mindroomUi.models.modelPicker.refresh')}
                onClick={state.refresh}
              >
                <IconRefresh size={16} />
              </button>
            </div>

            {state.runtimes.length > 1 && (
              <div className={css.RuntimeRow}>
                <span className={css.RuntimeLabel}>
                  {t('mindroomUi.models.modelPicker.runtime')}
                </span>
                <select
                  className={css.RuntimeSelect}
                  aria-label={t('mindroomUi.models.modelPicker.runtime')}
                  value={state.runtime?.id ?? ''}
                  onChange={(event) => state.chooseRuntime(event.currentTarget.value)}
                >
                  {!state.runtime && (
                    <option value="" disabled>
                      {t('mindroomUi.models.modelPicker.chooseRuntime')}
                    </option>
                  )}
                  {state.runtimes.map((runtime) => (
                    <option key={runtime.id} value={runtime.id}>
                      {t('mindroomUi.models.modelPicker.runtimeLabel', {
                        userId: runtime.userId,
                        deviceId: runtime.deviceId,
                      })}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {(state.loading || state.pending) && (
              <div className={css.StatusRow} role="status">
                <Spinner size="100" variant="Secondary" />
                {state.pending
                  ? t('mindroomUi.models.modelPicker.pending')
                  : t('mindroomUi.models.modelPicker.loading')}
              </div>
            )}

            {state.error && (
              <div className={css.Error} role="alert">
                <div>{state.error}</div>
                <div>{t('mindroomUi.models.modelPicker.commandFallback')}</div>
                <div className={css.ErrorActions}>
                  <button
                    type="button"
                    className={css.TextButton}
                    aria-label={t('mindroomUi.models.modelPicker.retry')}
                    onClick={state.refresh}
                  >
                    {t('mindroomUi.models.modelPicker.retry')}
                  </button>
                </div>
              </div>
            )}
          </Header>
        }
      >
        <div className={css.Results}>
          <div id={listId} role="listbox" aria-label={t('mindroomUi.models.modelPicker.models')}>
            {defaultVisible && (
              // Keyboard activation belongs to the searchbox, which retains DOM focus.
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events
              <div
                id={optionId(listId, 'default-action')}
                role="option"
                aria-selected={state.override === null}
                aria-disabled={mutationsDisabled}
                className={css.Option}
                data-active={activeItem?.kind === 'default'}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onPointerMove={() =>
                  setActiveIndex(items.findIndex((item) => item.kind === 'default'))
                }
                onClick={() => selectItem({ kind: 'default' })}
              >
                <span className={css.OptionIcon} aria-hidden="true">
                  <IconRotateClockwise size={18} />
                </span>
                <span className={css.OptionText}>
                  <span className={css.OptionTitle}>
                    {t('mindroomUi.models.modelPicker.useRoomDefault')}
                  </span>
                  <span className={css.OptionDetail}>
                    {t('mindroomUi.models.modelPicker.roomDefaultDescription')}
                  </span>
                </span>
                {state.override === null && <IconCheck className={css.Check} size={18} />}
              </div>
            )}

            {groups.map(([provider, models]) => (
              <div key={provider} className={css.Group} role="group" aria-label={provider}>
                <div className={css.GroupTitle}>{provider}</div>
                {models.map((model) => {
                  const index = items.findIndex(
                    (item) => item.kind === 'model' && item.model.key === model.key
                  );
                  const selected = state.override === model.key;
                  return (
                    // Keyboard activation belongs to the searchbox, which retains DOM focus.
                    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                    <div
                      key={model.key}
                      id={optionId(listId, `model:${model.key}`)}
                      role="option"
                      aria-selected={selected}
                      aria-disabled={mutationsDisabled}
                      className={css.Option}
                      data-active={
                        activeItem?.kind === 'model' && activeItem.model.key === model.key
                      }
                      tabIndex={-1}
                      onMouseDown={(event) => event.preventDefault()}
                      onPointerMove={() => setActiveIndex(index)}
                      onClick={() => selectItem({ kind: 'model', model })}
                    >
                      <span className={css.OptionIcon} aria-hidden="true">
                        <ModelIcon
                          provider={model.provider}
                          id={model.id}
                          iconUrl={model.icon_url}
                          size={20}
                        />
                      </span>
                      <span className={css.OptionText}>
                        <span className={css.OptionTitle}>{model.display_name}</span>
                        <span className={css.OptionDetail}>
                          {model.key} · {model.provider}
                        </span>
                      </span>
                      {selected && <IconCheck className={css.Check} size={18} />}
                    </div>
                  );
                })}
              </div>
            ))}

            {items.length === 0 && (
              <div className={css.Empty}>{t('mindroomUi.models.modelPicker.noResults')}</div>
            )}
          </div>
        </div>
      </PageScroll>
      <div className={css.Footer}>
        <span className={css.FooterText}>
          {state.inherited.length > 0
            ? t('mindroomUi.models.modelPicker.inheritedModels', {
                models: inheritedModels,
              })
            : t('mindroomUi.models.modelPicker.futureReplies')}
        </span>
      </div>
    </Surface>
  );
}

type SurfaceProps = {
  state: ModelPickerState;
  mobile: boolean;
  requestClose: () => void;
  onCommand: () => void;
};

function TrappedPanel({ state, mobile, requestClose, onCommand }: SurfaceProps) {
  return (
    <FocusTrap
      focusTrapOptions={{
        onDeactivate: requestClose,
        clickOutsideDeactivates: true,
        escapeDeactivates: stopPropagation,
        returnFocusOnDeactivate: true,
      }}
    >
      <div>
        <ModelPickerPanel
          state={state}
          mobile={mobile}
          requestClose={requestClose}
          onCommand={onCommand}
        />
      </div>
    </FocusTrap>
  );
}

function MobileSurface({ state, requestClose, onCommand }: Omit<SurfaceProps, 'mobile'>) {
  usePreventScroll();
  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <div className={css.MobileContainer}>
        <Modal
          appearance="glass"
          size="500"
          flexHeight
          variant="Background"
          className={css.MobilePanel}
        >
          <TrappedPanel state={state} mobile requestClose={requestClose} onCommand={onCommand} />
        </Modal>
      </div>
    </Overlay>
  );
}

export function ModelPicker({ state }: { state: ModelPickerState }) {
  const { t } = useTranslation();
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const triggerDescriptionId = useId();
  const commandStartedRef = useRef(false);
  const sawPendingRef = useRef(false);
  const selectedModel = state.models.find((model) => model.key === state.override);
  const label =
    selectedModel?.display_name ?? state.override ?? t('mindroomUi.models.modelPicker.roomDefault');

  const close = () => {
    commandStartedRef.current = false;
    sawPendingRef.current = false;
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open || !commandStartedRef.current) return;
    if (state.pending) {
      sawPendingRef.current = true;
      return;
    }
    if (!sawPendingRef.current) return;
    commandStartedRef.current = false;
    sawPendingRef.current = false;
    if (!state.error) close();
  }, [open, state.pending, state.error]);

  const openPicker = () => {
    setOpen(true);
    state.refresh();
  };

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className={css.Trigger}
      aria-label={t('mindroomUi.models.modelPicker.chooseModel')}
      aria-describedby={triggerDescriptionId}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={openPicker}
    >
      <ModelIcon
        provider={selectedModel?.provider}
        id={selectedModel?.id}
        iconUrl={selectedModel?.icon_url}
        size={15}
        className={css.TriggerIcon}
      />
      <span id={triggerDescriptionId} className={css.TriggerLabel}>
        {label}
      </span>
      <IconChevronDown size={14} aria-hidden="true" />
    </button>
  );

  if (mobile) {
    return (
      <>
        {trigger}
        {open && (
          <MobileSurface
            state={state}
            requestClose={close}
            onCommand={() => {
              commandStartedRef.current = true;
            }}
          />
        )}
      </>
    );
  }

  return (
    <PopOut
      anchor={open ? triggerRef.current?.getBoundingClientRect() : undefined}
      offset={8}
      position="Top"
      align="Start"
      content={
        open ? (
          <TrappedPanel
            state={state}
            mobile={false}
            requestClose={close}
            onCommand={() => {
              commandStartedRef.current = true;
            }}
          />
        ) : undefined
      }
    >
      {trigger}
    </PopOut>
  );
}

function ExistingThreadModelPicker({ room, threadId }: { room: Room; threadId: string }) {
  const { t } = useTranslation();
  const state = useModelPicker(room, threadId);
  if (!state.eligible) return null;

  return (
    <div className={css.ComposerRow}>
      <span className={css.ScopeLabel}>{t('mindroomUi.models.modelPicker.threadModel')}</span>
      <ModelPicker state={state} />
    </div>
  );
}

export function ThreadModelPicker({ room, threadId }: { room: Room; threadId?: string }) {
  if (!threadId) return null;
  return <ExistingThreadModelPicker room={room} threadId={threadId} />;
}
