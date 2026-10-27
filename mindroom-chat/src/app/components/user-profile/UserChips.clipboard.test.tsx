// @vitest-environment jsdom

import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMatrixToUser } from '../../plugins/matrix-to';
import { ServerChip, ShareChip } from './UserChips';

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn<(text: string) => Promise<boolean>>(),
}));

vi.mock('folds', async () => {
  const reactModule = await import('react');
  const actual = await vi.importActual<typeof import('folds')>('folds');
  const Container = ({ children, ...props }: { children?: React.ReactNode }) =>
    reactModule.createElement('div', props, children);

  return {
    ...actual,
    Avatar: Container,
    Box: Container,
    Chip: ({
      children,
      before,
      ...props
    }: {
      children?: React.ReactNode;
      before?: React.ReactNode;
    }) => reactModule.createElement('button', { ...props, 'data-chip': true }, before, children),
    Icon: ({ src, ...props }: { src?: string }) =>
      reactModule.createElement('i', { ...props, 'data-src': src }),
    Icons: {
      Check: 'Check',
      ChevronBottom: 'ChevronBottom',
      Link: 'Link',
      Server: 'Server',
    },
    Line: () => reactModule.createElement('hr'),
    Menu: Container,
    MenuItem: ({ children, ...props }: { children?: React.ReactNode }) =>
      reactModule.createElement('button', { ...props, 'data-menu-item': true }, children),
    PopOut: ({ children, content }: { children?: React.ReactNode; content?: React.ReactNode }) =>
      reactModule.createElement(reactModule.Fragment, null, children, content),
    Scroll: Container,
    Spinner: Container,
    Text: ({ children, ...props }: { children?: React.ReactNode }) =>
      reactModule.createElement('span', props, children),
    config: { space: { S100: '4px' } },
    toRem: (value: number) => `${value / 16}rem`,
  };
});

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('../room-avatar', () => ({
  RoomAvatar: () => React.createElement('span'),
  RoomIcon: () => React.createElement('span'),
}));

vi.mock('../cutout-card', () => ({
  CutoutCard: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../setting-tile', () => ({
  SettingTile: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@me:example.org' }),
}));

vi.mock('../../state/hooks/userRoomProfile', () => ({
  useCloseUserRoomProfile: () => vi.fn(),
}));

vi.mock('../../utils/dom', () => ({
  copyToClipboard: mocks.copyToClipboard,
}));

const getText = (node: ReactTestInstance | string): string =>
  typeof node === 'string'
    ? node
    : node.children.map((child) => getText(child as ReactTestInstance | string)).join('');

const getMenuButton = (renderer: ReactTestRenderer, label: string): ReactTestInstance =>
  renderer.root
    .findAll((node) => node.type === 'button' && node.props['data-menu-item'])
    .find((node) => getText(node) === label)!;

const hasSuccessFeedback = (renderer: ReactTestRenderer, kind: 'server' | 'share'): boolean =>
  kind === 'server'
    ? renderer.root.findAll((node) => node.props['data-src'] === 'Check').length > 0
    : renderer.root.findAll((node) => node.props['data-chip'] && node.props.variant === 'Success')
        .length > 0;

const CASES = [
  {
    kind: 'server' as const,
    label: 'Copy Server',
    expected: 'example.org',
    render: () => <ServerChip server="example.org" />,
  },
  {
    kind: 'share' as const,
    label: 'Copy User ID',
    expected: '@alice:example.org',
    render: () => <ShareChip userId="@alice:example.org" />,
  },
  {
    kind: 'share' as const,
    label: 'Copy User Link',
    expected: getMatrixToUser('@alice:example.org'),
    render: () => <ShareChip userId="@alice:example.org" />,
  },
];

describe('profile chip clipboard feedback', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each(CASES)('shows success for $label only when copy succeeds', async (testCase) => {
    mocks.copyToClipboard.mockResolvedValue(true);
    const renderer = create(testCase.render());

    await act(async () => {
      await getMenuButton(renderer, testCase.label).props.onClick();
    });

    expect(mocks.copyToClipboard).toHaveBeenCalledWith(testCase.expected);
    expect(hasSuccessFeedback(renderer, testCase.kind)).toBe(true);
    renderer.unmount();
  });

  it.each(CASES)('does not show success for failed $label', async (testCase) => {
    mocks.copyToClipboard.mockResolvedValue(false);
    const renderer = create(testCase.render());

    await act(async () => {
      await getMenuButton(renderer, testCase.label).props.onClick();
    });

    expect(mocks.copyToClipboard).toHaveBeenCalledWith(testCase.expected);
    expect(hasSuccessFeedback(renderer, testCase.kind)).toBe(false);
    renderer.unmount();
  });
});

describe('server chip', () => {
  it('opens the server in a new tab without an opener', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const renderer = create(<ServerChip server="example.org" />);

    act(() => {
      getMenuButton(renderer, 'Open in Browser').props.onClick();
    });

    expect(openSpy).toHaveBeenCalledWith('https://example.org', '_blank', 'noopener,noreferrer');
    openSpy.mockRestore();
    renderer.unmount();
  });
});
