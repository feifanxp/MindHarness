// @vitest-environment jsdom

import React, { useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Room } from 'matrix-js-sdk';
import {
  makeRoomSortableId,
  parseRoomSortableId,
  SortableRoomNavItem,
} from './SortableRoomNavItem';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../components/sidebar/Sidebar.css', () => ({
  SidebarDragSource: 'SidebarDragSource',
  SidebarRowDragSource: 'SidebarRowDragSource',
}));

vi.mock('./RoomNavItem', () => ({
  RoomNavItem: ({ room }: { room: Room }) => <span>{room.name}</span>,
}));

const rect = (top: number): DOMRect => ({
  bottom: top + 40,
  height: 40,
  left: 0,
  right: 200,
  top,
  width: 200,
  x: 0,
  y: top,
  toJSON: () => ({}),
});

const room = (roomId: string, name: string): Room =>
  ({
    roomId,
    name,
  } as unknown as Room);

function Harness({ onDragEnd }: { onDragEnd: (event: DragEndEvent) => void }) {
  const parentSpaceId = '!space:example.org';
  const [roomIds, setRoomIds] = useState(['!room-a:example.org', '!room-b:example.org']);
  const rooms = {
    '!room-a:example.org': room('!room-a:example.org', 'Alpha'),
    '!room-b:example.org': room('!room-b:example.org', 'Beta'),
  };
  const sortableIds = roomIds.map((roomId) => makeRoomSortableId(parentSpaceId, roomId));
  const sensors = useSensors(
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={(event) => {
        onDragEnd(event);
        if (!event.over) return;
        const activeRoom = parseRoomSortableId(event.active.id.toString());
        const overRoom = parseRoomSortableId(event.over.id.toString());
        if (!activeRoom || !overRoom || activeRoom.parentSpaceId !== overRoom.parentSpaceId) return;

        const oldIndex = roomIds.indexOf(activeRoom.roomId);
        const newIndex = roomIds.indexOf(overRoom.roomId);
        if (oldIndex >= 0 && newIndex >= 0) {
          setRoomIds(arrayMove(roomIds, oldIndex, newIndex));
        }
      }}
    >
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        {roomIds.map((roomId) => (
          <SortableRoomNavItem
            key={roomId}
            parentSpaceId={parentSpaceId}
            room={rooms[roomId]}
            selected={false}
            linkPath={`/room/${roomId}`}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}

describe('SortableRoomNavItem', () => {
  let container: HTMLDivElement;
  let root: Root;
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function getMockedRect(this: HTMLElement) {
        if (this.dataset.roomId === '!room-a:example.org') return rect(0);
        if (this.dataset.roomId === '!room-b:example.org') return rect(48);
        return rect(0);
      });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    rectSpy.mockRestore();
    container.remove();
  });

  it('builds and parses composite sortable ids with parent and room ids', () => {
    const sortableId = makeRoomSortableId('!space:example.org', '!room-a:example.org');

    expect(sortableId).toBe('!space:example.org::!room-a:example.org');
    expect(parseRoomSortableId(sortableId)).toEqual({
      parentSpaceId: '!space:example.org',
      roomId: '!room-a:example.org',
    });
  });

  it('commits keyboard reorder with Space, ArrowDown, Space', async () => {
    const onDragEnd = vi.fn();

    act(() => {
      root.render(<Harness onDragEnd={onDragEnd} />);
    });

    const firstItem = container.querySelector(
      '[data-room-id="!room-a:example.org"]'
    ) as HTMLElement;
    firstItem.focus();

    await act(async () => {
      firstItem.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })
      );
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true })
      );
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })
      );
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    expect(onDragEnd).toHaveBeenCalled();
    const lastEvent = onDragEnd.mock.lastCall?.[0] as DragEndEvent;
    expect(lastEvent.active.id).toBe('!space:example.org::!room-a:example.org');
    expect(lastEvent.over?.id).toBe('!space:example.org::!room-b:example.org');
    expect(parseRoomSortableId(lastEvent.active.id.toString())).toEqual({
      parentSpaceId: '!space:example.org',
      roomId: '!room-a:example.org',
    });
  });
});
