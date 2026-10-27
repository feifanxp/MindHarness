import React, { ComponentProps, CSSProperties } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SidebarRowDragSource } from '../../components/sidebar/Sidebar.css';
import { animateSortableLayoutDuringDrag } from '../../utils/sortableDrag';
import { RoomNavItem } from './RoomNavItem';

export type SortableRoomNavItemData = {
  roomId: string;
  parentSpaceId: string;
};

export const makeRoomSortableId = (parentSpaceId: string, roomId: string): string =>
  `${parentSpaceId}::${roomId}`;

export const parseRoomSortableId = (sortableId: string): SortableRoomNavItemData | undefined => {
  const separatorIndex = sortableId.indexOf('::');
  if (separatorIndex <= 0) return undefined;

  return {
    parentSpaceId: sortableId.slice(0, separatorIndex),
    roomId: sortableId.slice(separatorIndex + 2),
  };
};

type SortableRoomNavItemProps = ComponentProps<typeof RoomNavItem> & {
  parentSpaceId: string;
};

const sortableStyle = (
  transform: ReturnType<typeof useSortable>['transform'],
  transition: ReturnType<typeof useSortable>['transition'],
  dragging: boolean
): CSSProperties => ({
  transform: CSS.Transform.toString(transform),
  transition,
  opacity: dragging ? 0.45 : undefined,
});

export function SortableRoomNavItem({ parentSpaceId, room, ...props }: SortableRoomNavItemProps) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: makeRoomSortableId(parentSpaceId, room.roomId),
    animateLayoutChanges: animateSortableLayoutDuringDrag,
    data: {
      roomId: room.roomId,
      parentSpaceId,
    } satisfies SortableRoomNavItemData,
  });

  const stopMenuActivation = (evt: React.SyntheticEvent<HTMLElement>) => {
    if ((evt.target as HTMLElement).closest('button')) {
      evt.stopPropagation();
    }
  };

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        setActivatorNodeRef(node);
      }}
      className={SidebarRowDragSource}
      style={sortableStyle(transform, transition, isDragging)}
      data-room-id={room.roomId}
      onPointerDownCapture={stopMenuActivation}
      onKeyDownCapture={stopMenuActivation}
      {...attributes}
      {...listeners}
    >
      <RoomNavItem room={room} {...props} />
    </div>
  );
}
