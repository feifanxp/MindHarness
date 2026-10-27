import React from 'react';
import { act, create } from 'react-test-renderer';
import type { Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';

type MockRoomViewProps = {
  hasMindroomAgents?: boolean;
  eventId?: string;
  focusEventInRoom?: boolean;
  threadId?: string;
  onThreadLoadError?: (threadId: string) => void;
};

const { roomViewProps } = vi.hoisted(() => ({
  roomViewProps: { current: undefined as MockRoomViewProps | undefined },
}));

vi.mock('folds', () => ({
  Box: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  Icon: () => React.createElement('span'),
  IconButton: ({ children }: { children: React.ReactNode }) =>
    React.createElement('button', null, children),
  Icons: { Cross: 'cross' },
  Text: ({ children }: { children: React.ReactNode }) =>
    React.createElement('span', null, children),
  Tooltip: ({ children }: { children: React.ReactNode }) =>
    React.createElement('span', null, children),
  TooltipProvider: ({ children }: { children: (ref: undefined) => React.ReactNode }) =>
    React.createElement(React.Fragment, null, children(undefined)),
  toRem: (value: number) => `${value}rem`,
}));

vi.mock('jotai', async () => {
  const actual = await vi.importActual<typeof import('jotai')>('jotai');

  return {
    ...actual,
    useSetAtom: () => vi.fn(),
  };
});

vi.mock('../../components/page', () => ({
  Page: ({ children }: { children: React.ReactNode }) =>
    React.createElement('main', null, children),
  PageHeader: ({ children }: { children: React.ReactNode }) =>
    React.createElement('header', null, children),
}));

vi.mock('../../hooks/useScreenSize', () => ({
  ScreenSize: { Desktop: 'Desktop' },
  useScreenSizeContext: () => 'Desktop',
}));

vi.mock('./MindroomRoomView', () => ({
  RoomView: (props: MockRoomViewProps) => {
    roomViewProps.current = props;
    return React.createElement('mock-room-view');
  },
}));

describe('MindroomCallChatView', () => {
  it('forwards the thread route to the room view', async () => {
    const { MindroomCallChatView } = await import('./MindroomCallChatView');
    const room = { roomId: '!call:example.org' } as Room;
    const onThreadLoadError = vi.fn();

    await act(async () => {
      create(
        React.createElement(MindroomCallChatView, {
          room,
          hasMindroomAgents: false,
          eventId: '$reply',
          focusEventInRoom: true,
          threadId: '$root',
          onThreadLoadError,
        })
      );
    });

    expect(roomViewProps.current).toMatchObject({
      hasMindroomAgents: false,
      eventId: '$reply',
      focusEventInRoom: true,
      room,
      threadId: '$root',
      onThreadLoadError,
    });
  });
});
