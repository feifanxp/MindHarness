import { ReactNode } from 'react';
import { useBackRoute } from '../../components/BackRouteHandler';
import { useEdgeSwipeBack } from './useEdgeSwipeBack';

type MindroomBackRouteHandlerProps = {
  enableEdgeSwipe?: boolean;
  children: (onBack: () => void) => ReactNode;
};

export function MindroomBackRouteHandler({
  children,
  enableEdgeSwipe = true,
}: MindroomBackRouteHandlerProps) {
  const goBack = useBackRoute();

  useEdgeSwipeBack(goBack, enableEdgeSwipe, { blockStandaloneWebApp: true });

  return children(goBack);
}

export { BackRouteHandler } from '../../components/BackRouteHandler';
