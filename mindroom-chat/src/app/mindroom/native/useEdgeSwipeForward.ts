import { useEdgeSwipe } from './useEdgeSwipe';

export const useEdgeSwipeForward = (onForward: () => void, enabled: boolean = true): void => {
  useEdgeSwipe({ direction: 'forward', enabled, onSwipe: onForward });
};
