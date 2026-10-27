import { defaultAnimateLayoutChanges, type AnimateLayoutChanges } from '@dnd-kit/sortable';
import { suppressNextClickDefault } from './suppressNextClickDefault';

const POINTER_DRAG_ACTIVATOR_TYPES = new Set(['mousedown', 'pointerdown', 'touchstart']);

export const animateSortableLayoutDuringDrag: AnimateLayoutChanges = (args) => {
  if (args.wasDragging && !args.isSorting) {
    return false;
  }

  return defaultAnimateLayoutChanges(args);
};

export const suppressNextClickDefaultAfterPointerDrag = (activatorEvent: Event): (() => void) => {
  if (!POINTER_DRAG_ACTIVATOR_TYPES.has(activatorEvent.type)) {
    return () => undefined;
  }

  const target = activatorEvent.target;
  const ownerDocument = target instanceof Node ? target.ownerDocument ?? undefined : undefined;

  return suppressNextClickDefault(ownerDocument);
};
