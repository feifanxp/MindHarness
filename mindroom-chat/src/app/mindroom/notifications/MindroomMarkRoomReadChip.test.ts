import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { state, markRoomAndThreadsAsReadMock } = vi.hoisted(() => ({
  state: {
    hideActivity: false,
    mx: { clientId: 'mx' },
  },
  markRoomAndThreadsAsReadMock: vi.fn(),
}));

vi.mock('folds', async () => {
  const reactModule = await import('react');

  return {
    Chip: ({
      children,
      onClick,
    }: {
      children: React.ReactNode;
      onClick?: () => void;
    }) => reactModule.createElement('button', { onClick, type: 'button' }, children),
    Icon: ({ src }: { src: string }) => reactModule.createElement('span', { 'data-icon': src }),
    Icons: {
      CheckTwice: 'CheckTwice',
    },
    Text: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
  };
});

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => state.mx,
}));

vi.mock('../../state/hooks/settings', () => ({
  useSetting: () => [state.hideActivity],
}));

vi.mock('../../state/settings', () => ({
  settingsAtom: {},
}));

vi.mock('./readReceipts', () => ({
  markRoomAndThreadsAsRead: markRoomAndThreadsAsReadMock,
}));

afterEach(() => {
  state.hideActivity = false;
  markRoomAndThreadsAsReadMock.mockReset();
});

describe('MindroomMarkRoomReadChip', () => {
  it('marks the room and its threads as read', async () => {
    state.hideActivity = true;
    const { MindroomMarkRoomReadChip } = await import('./MindroomMarkRoomReadChip');
    const renderer = create(
      React.createElement(MindroomMarkRoomReadChip, { roomId: '!room:example.org' })
    );
    const button = renderer.root.findByType('button');

    act(() => {
      button.props.onClick();
    });

    expect(markRoomAndThreadsAsReadMock).toHaveBeenCalledWith(
      state.mx,
      '!room:example.org',
      true
    );
  });
});
