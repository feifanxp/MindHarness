import { useTranslation } from 'react-i18next';
import { RefObject, useCallback, useEffect, useMemo, useState } from 'react';
import { MatrixEvent } from 'matrix-js-sdk';
import { useTimelineMinimapInView } from './TimelineMinimap';
import { TimelineMinimapItem, deriveTimelineMinimapItems } from './timelineMinimapViewModel';
import type { OpenRoomEventHandler } from './roomEventOpenController';

type RoomTimelineMinimapOptions = {
  minimapEvents: readonly MatrixEvent[];
  showCompactRoomView: boolean;
  scrollRef: RefObject<HTMLElement>;
  handleOpenEvent: OpenRoomEventHandler;
};

export const useRoomTimelineMinimap = ({
  minimapEvents,
  showCompactRoomView,
  scrollRef,
  handleOpenEvent,
}: RoomTimelineMinimapOptions) => {
  const { t } = useTranslation();
  const [minimapStripMap] = useState(() => new Map<string, HTMLSpanElement>());
  // Fine-pointer only (like the reference implementation): touch devices
  // never see the minimap, so skip deriving items and tracking scroll there.
  const [minimapPointerFine, setMinimapPointerFine] = useState(
    () => typeof window !== 'undefined' && (window.matchMedia?.('(pointer: fine)').matches ?? false)
  );
  useEffect(() => {
    const queryList =
      typeof window === 'undefined' ? undefined : window.matchMedia?.('(pointer: fine)');
    if (!queryList) return undefined;
    const handleChange = () => setMinimapPointerFine(queryList.matches);
    queryList.addEventListener('change', handleChange);
    return () => queryList.removeEventListener('change', handleChange);
  }, []);
  const minimapEnabled = minimapPointerFine && !showCompactRoomView;
  const minimapItems = useMemo(
    () => (minimapEnabled ? deriveTimelineMinimapItems(minimapEvents, t) : []),
    [minimapEnabled, minimapEvents, t]
  );
  useTimelineMinimapInView(scrollRef, minimapItems, minimapStripMap, minimapEnabled);
  const handleMinimapSelect = useCallback(
    (item: TimelineMinimapItem) => {
      void handleOpenEvent(item.id, false);
    },
    [handleOpenEvent]
  );

  return { minimapStripMap, minimapItems, handleMinimapSelect };
};
