import React from 'react';
import type { Room } from 'matrix-js-sdk';
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
    Icon: ({ src }: { src: string }) => reactModule.createElement('span', { 'data-icon': src }),
    Icons: {
      CheckTwice: 'CheckTwice',
    },
    MenuItem: ({
      children,
      'aria-disabled': ariaDisabled,
      disabled,
      onClick,
    }: {
      children: React.ReactNode;
      'aria-disabled'?: boolean;
      disabled?: boolean;
      onClick?: () => void;
    }) =>
      reactModule.createElement(
        'button',
        { 'aria-disabled': ariaDisabled, disabled, onClick, type: 'button' },
        children
      ),
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

const room = { roomId: '!room:example.org' } as Room;

afterEach(() => {
  state.hideActivity = false;
  markRoomAndThreadsAsReadMock.mockReset();
});

describe('MindroomMarkRoomReadMenuItem', () => {
  it.each([false, true])(
    'marks the room and closes the menu (private: %s)',
    async (hideActivity) => {
      const onClose = vi.fn();
      state.hideActivity = hideActivity;
      const { MindroomMarkRoomReadMenuItem } = await import('./MindroomMarkRoomReadMenuItem');
      const renderer = create(React.createElement(MindroomMarkRoomReadMenuItem, { room, onClose }));
      const button = renderer.root.findByType('button');

      act(() => button.props.onClick());

      expect(button.props.disabled).toBeUndefined();
      expect(button.props['aria-disabled']).not.toBe(true);
      expect(markRoomAndThreadsAsReadMock).toHaveBeenCalledWith(
        state.mx,
        room.roomId,
        hideActivity
      );
      expect(onClose).toHaveBeenCalledOnce();
    }
  );
});
