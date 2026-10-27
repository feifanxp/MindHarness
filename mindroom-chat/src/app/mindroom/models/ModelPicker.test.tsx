// @vitest-environment jsdom

import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, Root } from 'react-dom/client';
import { Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize } from '../../hooks/useScreenSize';
import type { ModelPickerState } from './useModelPicker';
import { ModelPicker, ThreadModelPicker } from './ModelPicker';
import { ModelIcon } from './ModelIcon';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  screenSize: 'Desktop',
  useModelPicker: vi.fn(),
  mxcUrlToHttp: vi.fn(() => 'https://matrix.example/media/icon'),
}));

vi.mock('../../components/page', () => ({
  PageScroll: ({
    header,
    children,
    scrollRef,
  }: {
    header?: React.ReactNode;
    children: React.ReactNode;
    scrollRef?: React.RefObject<HTMLDivElement>;
  }) => (
    <div ref={scrollRef}>
      {header}
      {children}
    </div>
  ),
}));
vi.mock('./ModelPicker.css', () => ({
  Check: 'Check',
  ComposerRow: 'ComposerRow',
  Controls: 'Controls',
  Empty: 'Empty',
  Error: 'Error',
  ErrorActions: 'ErrorActions',
  Footer: 'Footer',
  FooterText: 'FooterText',
  Group: 'Group',
  GroupTitle: 'GroupTitle',
  Header: 'Header',
  HeaderText: 'HeaderText',
  IconButton: 'IconButton',
  IconImage: 'IconImage',
  MobileContainer: 'MobileContainer',
  MobilePanel: 'MobilePanel',
  Option: 'Option',
  OptionDetail: 'OptionDetail',
  OptionIcon: 'OptionIcon',
  OptionText: 'OptionText',
  OptionTitle: 'OptionTitle',
  Panel: 'Panel',
  Results: 'Results',
  RuntimeLabel: 'RuntimeLabel',
  RuntimeRow: 'RuntimeRow',
  RuntimeSelect: 'RuntimeSelect',
  ScopeLabel: 'ScopeLabel',
  SearchInput: 'SearchInput',
  SearchRow: 'SearchRow',
  StatusRow: 'StatusRow',
  Subtitle: 'Subtitle',
  TextButton: 'TextButton',
  Title: 'Title',
  Trigger: 'Trigger',
  TriggerIcon: 'TriggerIcon',
  TriggerLabel: 'TriggerLabel',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const strings: Record<string, string> = {
        'mindroomUi.models.modelPicker.chooseModel': 'Choose model',
        'mindroomUi.models.modelPicker.roomDefault': 'Room default',
        'mindroomUi.models.modelPicker.modelForThread': 'Model for this thread',
        'mindroomUi.models.modelPicker.appliesToThread':
          'Applies to all agents and teams for future replies in this thread.',
        'mindroomUi.models.modelPicker.search': 'Search models',
        'mindroomUi.models.modelPicker.close': 'Close model picker',
        'mindroomUi.models.modelPicker.useRoomDefault': 'Use room default',
        'mindroomUi.models.modelPicker.roomDefaultDescription':
          'Let each agent use its configured model.',
        'mindroomUi.models.modelPicker.models': 'Models',
        'mindroomUi.models.modelPicker.runtime': 'Runtime',
        'mindroomUi.models.modelPicker.chooseRuntime': 'Choose a runtime',
        'mindroomUi.models.modelPicker.refresh': 'Refresh models',
        'mindroomUi.models.modelPicker.retry': 'Retry',
        'mindroomUi.models.modelPicker.loading': 'Loading models',
        'mindroomUi.models.modelPicker.pending': 'Waiting for model change',
        'mindroomUi.models.modelPicker.noResults': 'No matching models',
        'mindroomUi.models.modelPicker.commandFallback':
          'You can still send !model with a model key in this thread.',
        'mindroomUi.models.modelPicker.inheritedModels': `Room defaults by agent: ${String(
          options?.models
        )}`,
        'mindroomUi.models.modelPicker.futureReplies': 'Changes apply to future replies.',
        'mindroomUi.models.modelPicker.runtimeLabel': `${String(options?.userId)} on ${String(
          options?.deviceId
        )}`,
      };
      return strings[key] ?? key;
    },
  }),
}));

vi.mock('folds', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Modal: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  Overlay: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  OverlayBackdrop: () => <div />,
  PopOut: ({ children, content }: { children?: React.ReactNode; content?: React.ReactNode }) => (
    <div>
      {children}
      {content}
    </div>
  ),
  Spinner: () => <span role="progressbar" aria-label="Loading" />,
}));

vi.mock('../../components/glass/GlassPrimitives', () => ({
  Header: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  Surface: ({
    children,
    appearance = 'glass',
    level = 'overlay',
    variant = 'Surface',
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & {
    appearance?: string;
    level?: string;
    variant?: string;
  }) => (
    <div
      data-shared-surface={appearance}
      data-surface-level={level}
      data-surface-variant={variant}
      {...props}
    >
      {children}
    </div>
  ),
  Modal: ({
    children,
    appearance = 'glass',
    variant = 'Surface',
    size,
    flexHeight,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & {
    appearance?: string;
    variant?: string;
    size?: string;
    flexHeight?: boolean;
  }) => (
    <div
      data-shared-modal={appearance}
      data-modal-variant={variant}
      data-modal-size={size}
      data-modal-flex-height={flexHeight ? 'true' : undefined}
      {...props}
    >
      {children}
    </div>
  ),
}));

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../hooks/useScreenSize', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useScreenSizeContext: () => mocks.screenSize,
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => '@viewer:example.org' }),
}));

vi.mock('../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => true,
}));

vi.mock('../../utils/matrix', () => ({
  mxcUrlToHttp: mocks.mxcUrlToHttp,
}));

vi.mock('./useModelPicker', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useModelPicker: mocks.useModelPicker,
}));

const runtime = {
  id: 'runtime-one',
  userId: '@runtime:example.org',
  deviceId: 'DESKTOP',
  curveKey: 'private-transport-key',
};

const createState = (patch: Partial<ModelPickerState> = {}): ModelPickerState => ({
  eligible: true,
  runtimes: [runtime],
  runtime,
  models: [
    {
      key: 'fast',
      display_name: 'Quick helper',
      provider: 'OpenAI',
      id: 'fast-model',
      icon_url: 'mxc://example.org/fast',
    },
    {
      key: 'reset',
      display_name: 'Deep reasoning',
      provider: 'Anthropic',
      id: 'reasoning-model',
    },
    {
      key: 'default',
      display_name: 'Named default',
      provider: 'Local',
      id: 'default-model',
    },
  ],
  override: null,
  inherited: [{ entity: 'assistant', model: 'fast' }],
  loading: false,
  pending: false,
  canMutate: true,
  refresh: vi.fn(),
  chooseRuntime: vi.fn(),
  selectModel: vi.fn(),
  resetToRoomDefault: vi.fn(),
  ...patch,
});

const click = (element: Element) => {
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};

const input = (element: HTMLInputElement, value: string) => {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const keyDown = (element: Element, key: string) => {
  act(() => element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
};

describe('responsive model picker', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.screenSize = ScreenSize.Desktop;
    mocks.useModelPicker.mockReset();
    mocks.mxcUrlToHttp.mockClear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.replaceChildren();
  });

  it('does not subscribe or render outside an existing thread', () => {
    act(() => root.render(<ThreadModelPicker room={{} as Room} />));

    expect(mocks.useModelPicker).not.toHaveBeenCalled();
    expect(container.querySelector('button[aria-label="Choose model"]')).toBeNull();
  });

  it.each(['regular room', 'router only', 'invited agent', 'left agent'])(
    'hides the selector for an ineligible %s snapshot',
    () => {
      mocks.useModelPicker.mockReturnValue(createState({ eligible: false }));

      act(() => root.render(<ThreadModelPicker room={{} as Room} threadId="$thread" />));

      expect(container.querySelector('button[aria-label="Choose model"]')).toBeNull();
    }
  );

  it('searches display name, stable key, and provider while grouping visible models', () => {
    act(() => root.render(<ModelPicker state={createState()} />));
    click(container.querySelector('button[aria-label="Choose model"]')!);

    const search = container.querySelector('input[role="searchbox"]') as HTMLInputElement;
    expect(search).toBe(document.activeElement);

    input(search, 'quick');
    expect(container.querySelector('[role="option"]')?.textContent).toContain('Quick helper');
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(1);

    input(search, 'reset');
    expect(container.querySelector('[role="option"]')?.textContent).toContain('Deep reasoning');

    input(search, 'local');
    expect(container.querySelector('[role="group"]')?.textContent).toContain('Local');
    expect(container.querySelector('[role="option"]')?.textContent).toContain('Named default');
  });

  it('keeps room reset distinct from selecting a model whose stable key is default', () => {
    const state = createState({ override: 'default' });
    act(() => root.render(<ModelPicker state={state} />));
    click(container.querySelector('button[aria-label="Choose model"]')!);

    const defaultAction = [...container.querySelectorAll('[role="option"]')].find((option) =>
      option.textContent?.includes('Use room default')
    )!;
    const namedDefault = [...container.querySelectorAll('[role="option"]')].find((option) =>
      option.textContent?.includes('Named default')
    )!;

    expect(defaultAction.getAttribute('aria-selected')).toBe('false');
    expect(namedDefault.getAttribute('aria-selected')).toBe('true');

    click(namedDefault);
    expect(state.selectModel).toHaveBeenCalledWith('default');
    expect(state.resetToRoomDefault).not.toHaveBeenCalled();
  });

  it('sets a configured model whose key matches the room-default DOM identity', () => {
    const state = createState({
      models: [
        {
          key: 'room-default',
          display_name: 'Configured fallback',
          provider: 'Local',
          id: 'configured-fallback',
        },
      ],
    });
    act(() => root.render(<ModelPicker state={state} />));
    click(container.querySelector('button[aria-label="Choose model"]')!);

    click(
      [...container.querySelectorAll('[role="option"]')].find((option) =>
        option.textContent?.includes('Configured fallback')
      )!
    );

    expect(state.selectModel).toHaveBeenCalledWith('room-default');
    expect(state.resetToRoomDefault).not.toHaveBeenCalled();
  });

  it('moves through options in the same order as interleaved provider groups render', () => {
    const state = createState({
      models: [
        { key: 'a', display_name: 'Alpha', provider: 'OpenAI', id: 'a-model' },
        { key: 'b', display_name: 'Beta', provider: 'Anthropic', id: 'b-model' },
        { key: 'c', display_name: 'Charlie', provider: 'OpenAI', id: 'c-model' },
      ],
    });
    act(() => root.render(<ModelPicker state={state} />));
    click(container.querySelector('button[aria-label="Choose model"]')!);

    const rendered = [...container.querySelectorAll('[role="option"]')].map(
      (option) => option.textContent
    );
    expect(rendered[1]).toContain('Alpha');
    expect(rendered[2]).toContain('Charlie');

    const search = container.querySelector('input[role="searchbox"]')!;
    keyDown(search, 'ArrowDown');
    keyDown(search, 'ArrowDown');
    keyDown(search, 'Enter');

    expect(state.selectModel).toHaveBeenCalledWith('c');
  });

  it('supports arrow selection, Enter, and Escape from the searchbox', () => {
    const state = createState();
    act(() => root.render(<ModelPicker state={state} />));
    click(container.querySelector('button[aria-label="Choose model"]')!);

    const search = container.querySelector('input[role="searchbox"]')!;
    keyDown(search, 'ArrowDown');
    keyDown(search, 'Enter');
    expect(state.selectModel).toHaveBeenCalledWith('fast');

    keyDown(search, 'Escape');
    expect(container.querySelector('input[role="searchbox"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Choose model"]')).toBe(
      document.activeElement
    );
  });

  it('shows an explicit readable chooser when multiple runtimes answer', () => {
    const secondRuntime = {
      ...runtime,
      id: 'runtime-two',
      userId: '@second-runtime:example.org',
      deviceId: 'MOBILE',
    };
    const state = createState({
      runtimes: [runtime, secondRuntime],
      runtime: undefined,
      canMutate: false,
      models: [],
    });
    act(() => root.render(<ModelPicker state={state} />));
    click(container.querySelector('button[aria-label="Choose model"]')!);

    const chooser = container.querySelector('select[aria-label="Runtime"]') as HTMLSelectElement;
    expect(chooser.textContent).toContain('@runtime:example.org on DESKTOP');
    expect(chooser.textContent).toContain('@second-runtime:example.org on MOBILE');

    act(() => {
      chooser.value = 'runtime-two';
      chooser.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(state.chooseRuntime).toHaveBeenCalledWith('runtime-two');
  });

  it('keeps refresh and dismissal available while a command is pending', () => {
    const state = createState({ pending: true, loading: true, canMutate: false });
    act(() => root.render(<ModelPicker state={state} />));
    click(container.querySelector('button[aria-label="Choose model"]')!);

    const refresh = container.querySelector('button[aria-label="Refresh models"]')!;
    expect(refresh.hasAttribute('disabled')).toBe(false);
    click(refresh);
    expect(state.refresh).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(container.querySelector('[role="option"]')?.getAttribute('aria-disabled')).toBe('true');

    click(container.querySelector('button[aria-label="Close model picker"]')!);
    expect(container.querySelector('input[role="searchbox"]')).toBeNull();
  });

  it('uses controller availability for model and reset activation while recovery is blocked', () => {
    const state = createState({
      canMutate: false,
      pending: false,
      loading: false,
      error: 'Recovery unavailable.',
    });
    act(() => root.render(<ModelPicker state={state} />));
    click(container.querySelector('button[aria-label="Choose model"]')!);
    const options = [...container.querySelectorAll('[role="option"]')];
    expect(options.every((option) => option.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    options.forEach(click);
    let search = container.querySelector('input[role="searchbox"]')!;
    keyDown(search, 'Enter');
    keyDown(search, 'ArrowDown');
    keyDown(search, 'Enter');
    expect(state.selectModel).not.toHaveBeenCalled();
    expect(state.resetToRoomDefault).not.toHaveBeenCalled();
    click(container.querySelector('button[aria-label="Refresh models"]')!);
    click(container.querySelector('button[aria-label="Retry"]')!);
    expect(state.refresh).toHaveBeenCalledTimes(3);
    keyDown(search, 'Escape');
    expect(container.querySelector('input[role="searchbox"]')).toBeNull();
    click(container.querySelector('button[aria-label="Choose model"]')!);
    act(() => root.render(<ModelPicker state={{ ...state, canMutate: true }} />));
    expect(
      [...container.querySelectorAll('[role="option"]')].every(
        (option) => option.getAttribute('aria-disabled') === 'false'
      )
    ).toBe(true);
    search = container.querySelector('input[role="searchbox"]')!;
    keyDown(search, 'Enter');
    keyDown(search, 'ArrowDown');
    keyDown(search, 'Enter');
    expect(state.resetToRoomDefault).toHaveBeenCalledOnce();
    expect(state.selectModel).toHaveBeenCalledWith('fast');
  });

  it('keeps an error open with retry and readable command fallback', () => {
    const state = createState({ error: 'Model discovery unavailable.' });
    act(() => root.render(<ModelPicker state={state} />));
    click(container.querySelector('button[aria-label="Choose model"]')!);

    expect(container.textContent).toContain('Model discovery unavailable.');
    expect(container.textContent).toContain('You can still send !model with a model key');
    click(container.querySelector('button[aria-label="Retry"]')!);
    expect(state.refresh).toHaveBeenCalledTimes(2);
  });

  it('shows each inherited room default while an override is selected', () => {
    const state = createState({
      override: 'reset',
      inherited: [
        { entity: 'assistant', model: 'fast' },
        { entity: 'reviewer', model: 'legacy-key' },
      ],
    });
    act(() => root.render(<ModelPicker state={state} />));
    click(container.querySelector('button[aria-label="Choose model"]')!);

    expect(container.textContent).toContain(
      'Room defaults by agent: assistant: Quick helper, reviewer: legacy-key'
    );
  });

  it('does not steal focus when a dismissed pending command later succeeds', () => {
    const state = createState();
    const outside = document.createElement('input');
    document.body.append(outside);
    act(() => root.render(<ModelPicker state={state} />));
    click(container.querySelector('button[aria-label="Choose model"]')!);
    click(
      [...container.querySelectorAll('[role="option"]')].find((option) =>
        option.textContent?.includes('Quick helper')
      )!
    );

    act(() => root.render(<ModelPicker state={{ ...state, pending: true, canMutate: false }} />));
    click(container.querySelector('button[aria-label="Close model picker"]')!);
    outside.focus();
    act(() => root.render(<ModelPicker state={{ ...state, pending: false }} />));

    expect(document.activeElement).toBe(outside);
  });

  it('does not let a command acknowledged while dismissed close a later opening', () => {
    const state = createState();
    act(() => root.render(<ModelPicker state={state} />));
    click(container.querySelector('button[aria-label="Choose model"]')!);
    click(
      [...container.querySelectorAll('[role="option"]')].find((option) =>
        option.textContent?.includes('Quick helper')
      )!
    );

    act(() => root.render(<ModelPicker state={{ ...state, pending: true, canMutate: false }} />));
    click(container.querySelector('button[aria-label="Close model picker"]')!);
    act(() => root.render(<ModelPicker state={{ ...state, pending: false }} />));
    click(container.querySelector('button[aria-label="Choose model"]')!);

    expect(container.querySelector('input[role="searchbox"]')).not.toBeNull();
  });

  it('does not let a dismissed command close a reopening when its acknowledgement arrives', () => {
    const state = createState();
    act(() => root.render(<ModelPicker state={state} />));
    click(container.querySelector('button[aria-label="Choose model"]')!);
    click(
      [...container.querySelectorAll('[role="option"]')].find((option) =>
        option.textContent?.includes('Quick helper')
      )!
    );

    act(() => root.render(<ModelPicker state={{ ...state, pending: true, canMutate: false }} />));
    click(container.querySelector('button[aria-label="Close model picker"]')!);
    click(container.querySelector('button[aria-label="Choose model"]')!);
    expect(container.querySelector('input[role="searchbox"]')).not.toBeNull();

    act(() => root.render(<ModelPicker state={{ ...state, pending: false }} />));

    expect(container.querySelector('input[role="searchbox"]')).not.toBeNull();
  });

  it('exposes the current visible model label as the trigger description', () => {
    act(() => root.render(<ModelPicker state={createState({ override: 'reset' })} />));

    const trigger = container.querySelector('button[aria-label="Choose model"]')!;
    const descriptionId = trigger.getAttribute('aria-describedby');

    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId!)?.textContent).toBe('Deep reasoning');
  });

  it('states that future thread replies use the selection for all agents and teams', () => {
    act(() => root.render(<ModelPicker state={createState()} />));
    click(container.querySelector('button[aria-label="Choose model"]')!);

    expect(container.textContent).toContain(
      'Applies to all agents and teams for future replies in this thread.'
    );
  });

  it('uses the shared glass surface owner for the desktop panel', () => {
    act(() => root.render(<ModelPicker state={createState()} />));
    click(container.querySelector('button[aria-label="Choose model"]')!);

    const panel = container.querySelector('[data-model-picker-sheet="desktop"]')!;
    expect(panel.getAttribute('data-shared-surface')).toBe('glass');
    expect(panel.getAttribute('data-surface-level')).toBe('overlay');
    expect(panel.getAttribute('data-surface-variant')).toBe('Surface');
  });

  it('uses a bottom sheet presentation on mobile', () => {
    mocks.screenSize = ScreenSize.Mobile;
    act(() => root.render(<ModelPicker state={createState()} />));
    click(container.querySelector('button[aria-label="Choose model"]')!);

    expect(container.querySelector('[data-model-picker-sheet="mobile"]')).not.toBeNull();
    expect(container.querySelector('[data-shared-modal="glass"]')).not.toBeNull();
    expect(
      container.querySelector('[data-model-picker-sheet="mobile"][data-shared-surface="inherit"]')
    ).not.toBeNull();
  });

  it('loads custom icons through authenticated Matrix media and falls back on image error', () => {
    act(() =>
      root.render(
        <ModelIcon provider="OpenAI" id="fast-model" iconUrl="mxc://example.org/fast" size={24} />
      )
    );

    const image = container.querySelector('img')!;
    expect(image.getAttribute('src')).toBe('https://matrix.example/media/icon');
    expect(mocks.mxcUrlToHttp).toHaveBeenCalledWith(
      expect.anything(),
      'mxc://example.org/fast',
      true,
      48,
      48,
      'scale'
    );

    act(() => image.dispatchEvent(new Event('error')));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
