import { useEdgeSwipe } from './useEdgeSwipe';

export const useEdgeSwipeBack = (
  onBack: () => void,
  enabled: boolean = true,
  options: { blockStandaloneWebApp?: boolean } = {}
): void => {
  useEdgeSwipe({
    direction: 'back',
    enabled,
    onSwipe: onBack,
    blockStandaloneWebApp: options.blockStandaloneWebApp,
  });
};
