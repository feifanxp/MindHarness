import React from 'react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StateEvent } from '../../../../types/matrix/room';
import { PowersEditor } from './PowersEditor';

const mocks = vi.hoisted(() => ({
  sendStateEvent: vi.fn().mockResolvedValue(undefined),
  tagsContent: {} as Record<number, { name: string; color?: string }>,
}));

vi.mock('folds', () => ({
  Box: ({ as = 'div', children, ...props }: React.PropsWithChildren<{ as?: string }>) =>
    React.createElement(as, props, children),
  Button: ({ before, children, ...props }: React.PropsWithChildren<{ before?: React.ReactNode }>) =>
    React.createElement('button', props, before, children),
  Chip: ({ before, children, ...props }: React.PropsWithChildren<{ before?: React.ReactNode }>) =>
    React.createElement('button', props, before, children),
  Icon: ({ src }: { src: string }) => React.createElement('span', { 'data-icon': src }),
  IconButton: ({ children, ...props }: React.PropsWithChildren) =>
    React.createElement('button', props, children),
  Icons: {
    ArrowLeft: 'arrow-left',
    Cross: 'cross',
    Delete: 'delete',
    SmilePlus: 'smile-plus',
  },
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) =>
    React.createElement('input', props),
  Menu: ({ children }: React.PropsWithChildren) => React.createElement('div', null, children),
  PopOut: ({ children }: React.PropsWithChildren) =>
    React.createElement(React.Fragment, null, children),
  Scroll: ({ children }: React.PropsWithChildren) => React.createElement('div', null, children),
  Spinner: () => null,
  Text: ({ as = 'span', children }: React.PropsWithChildren<{ as?: string }>) =>
    React.createElement(as, null, children),
  Tooltip: ({ children }: React.PropsWithChildren) => React.createElement('span', null, children),
  TooltipProvider: ({
    children,
  }: {
    children: (triggerRef: React.Ref<HTMLElement>) => React.ReactNode;
  }) => children(null),
  config: { space: { S200: '0.5rem', S400: '1rem' } },
  toRem: (value: number) => `${value / 16}rem`,
}));

vi.mock('jotai', () => ({ useAtomValue: () => new Map() }));
vi.mock('react-colorful', () => ({ HexColorPicker: () => null }));
vi.mock('../../../components/page', () => ({
  PageScroll: ({ header, children }: React.PropsWithChildren<{ header?: React.ReactNode }>) =>
    React.createElement('div', null, header, children),
  Page: ({ children }: React.PropsWithChildren) => React.createElement('main', null, children),
  PageContent: ({ children }: React.PropsWithChildren) =>
    React.createElement('div', null, children),
  PageHeader: ({ children }: React.PropsWithChildren) =>
    React.createElement('header', null, children),
}));
vi.mock('../../../components/sequence-card', () => ({
  SequenceCard: ({ children }: React.PropsWithChildren) =>
    React.createElement('div', null, children),
}));
vi.mock('../../../components/setting-tile', () => ({
  SettingTile: ({
    before,
    title,
    description,
    after,
  }: {
    before?: React.ReactNode;
    title: React.ReactNode;
    description?: React.ReactNode;
    after?: React.ReactNode;
  }) => React.createElement('section', null, before, title, description, after),
}));
vi.mock('../../../components/HexColorPickerPopOut', () => ({
  HexColorPickerPopOut: ({
    children,
  }: {
    children: (open: () => void, opened: boolean) => React.ReactNode;
  }) => children(() => undefined, false),
}));
vi.mock('../../../components/power', () => ({
  PowerColorBadge: () => null,
  PowerIcon: () => null,
}));
vi.mock('../../../components/UseStateProvider', () => ({
  UseStateProvider: ({
    initial,
    children,
  }: {
    initial: unknown;
    children: (
      value: unknown,
      setValue: React.Dispatch<React.SetStateAction<unknown>>
    ) => React.ReactNode;
  }) => {
    const [value, setValue] = React.useState(initial);
    return children(value, setValue);
  },
}));
vi.mock('../../../components/emoji-board', () => ({ EmojiBoard: () => null }));
vi.mock('../../../components/upload-card', () => ({ CompactUploadCardRenderer: () => null }));
vi.mock('../../../components/BetaNoticeBadge', () => ({ BetaNoticeBadge: () => null }));
vi.mock('../../../hooks/useImagePackRooms', () => ({ useImagePackRooms: () => [] }));
vi.mock('../../../hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('../../../hooks/useFilePicker', () => ({ useFilePicker: () => vi.fn() }));
vi.mock('../../../hooks/useAlive', () => ({ useAlive: () => () => true }));
vi.mock('../../../hooks/useMemberPowerTag', () => ({ getPowerTagIconSrc: () => undefined }));
vi.mock('../../../hooks/useStateEvent', () => ({
  useStateEvent: () => ({ getContent: () => mocks.tagsContent }),
}));
vi.mock('../../../state/upload', () => ({ createUploadAtom: vi.fn() }));
vi.mock('../../../state/room/roomToParents', () => ({ roomToParentsAtom: {} }));
vi.mock('../../../utils/matrix', () => ({ creatorsSupported: () => true }));
vi.mock('../styles.css', () => ({ SequenceCardStyle: 'sequence-card' }));

const room = {
  roomId: '!room:example.org',
  getVersion: () => '1',
};

vi.mock('../../../hooks/useRoom', () => ({ useRoom: () => room }));
vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ sendStateEvent: mocks.sendStateEvent }),
}));

const nodeText = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : nodeText(child))).join('');

const buttonByText = (renderer: ReactTestRenderer, label: string): ReactTestInstance => {
  const button = renderer.root
    .findAllByType('button')
    .find((candidate) => nodeText(candidate) === label);
  if (!button) throw new Error(`Missing ${label} button`);
  return button;
};

describe('PowersEditor power-level tag persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendStateEvent.mockResolvedValue(undefined);
    mocks.tagsContent = {
      25: { name: 'Obsolete role' },
      50: { name: 'Room-authored moderator', color: '#123456' },
    };
  });

  it('persists only explicit edits over the latest stored tags, never localized defaults', async () => {
    const language = createInstance();
    await language.init({
      lng: 'de',
      fallbackLng: 'en',
      react: { useSuspense: false },
      resources: {
        de: {
          translation: {
            sharedUi: {
              powerLevels: {
                admin: 'DE Admin',
                member: 'DE Mitglied',
              },
            },
            featureUi: {
              commonSettings: {
                permissions: {
                  powersEditor: {
                    applyChanges: 'Änderungen anwenden',
                    create: 'Erstellen',
                    save: 'Speichern',
                  },
                },
              },
            },
          },
        },
        en: {
          translation: {
            sharedUi: {
              powerLevels: {
                admin: 'EN Admin',
                member: 'EN Member',
              },
            },
            featureUi: {
              commonSettings: {
                permissions: {
                  powersEditor: {
                    applyChanges: 'Apply changes',
                    create: 'Create',
                    save: 'Save',
                  },
                },
              },
            },
          },
        },
      },
    });

    const powerLevels = {
      users: { '@admin:example.org': 100 },
      users_default: 0,
    };
    const view = () => (
      <I18nextProvider i18n={language}>
        <PowersEditor powerLevels={powerLevels} requestClose={() => undefined} />
      </I18nextProvider>
    );
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(view());
    });

    expect(nodeText(renderer.root)).toContain('DE Admin');
    act(() => buttonByText(renderer, 'Erstellen').props.onClick());
    const form = renderer.root.findByType('form');
    act(() => {
      form.props.onSubmit({
        preventDefault: () => undefined,
        target: {
          powerInput: { value: '75' },
          nameInput: { value: 'Custom helper' },
        },
      });
    });

    const obsoleteRole = renderer.root
      .findAllByType('section')
      .find((section) => nodeText(section).includes('Obsolete role'));
    expect(obsoleteRole).toBeDefined();
    act(() => obsoleteRole?.findAllByType('button')[0].props.onClick());

    await act(async () => {
      await language.changeLanguage('en');
    });
    expect(nodeText(renderer.root)).toContain('EN Admin');
    expect(nodeText(renderer.root)).toContain('Custom helper');

    mocks.tagsContent = {
      25: { name: 'Obsolete role' },
      50: { name: 'Updated room-authored moderator', color: '#abcdef' },
      60: { name: 'Concurrent live role' },
    };
    act(() => renderer.update(view()));

    await act(async () => {
      buttonByText(renderer, 'Apply changes').props.onClick();
      await Promise.resolve();
    });

    expect(mocks.sendStateEvent).toHaveBeenCalledWith(
      '!room:example.org',
      StateEvent.PowerLevelTags,
      {
        50: { name: 'Updated room-authored moderator', color: '#abcdef' },
        60: { name: 'Concurrent live role' },
        75: { name: 'Custom helper', color: undefined, icon: undefined },
      }
    );
  });
});
