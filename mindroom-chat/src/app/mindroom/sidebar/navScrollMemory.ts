import { useLayoutEffect, useRef } from 'react';
import { type VirtualItem, useVirtualizer } from '@tanstack/react-virtual';

type NavScrollMemory = {
  scrollOffset: number;
  measurements: VirtualItem[];
};

type NavVirtualizerOptions<TScrollElement extends Element, TItemElement extends Element> = Omit<
  Parameters<typeof useVirtualizer<TScrollElement, TItemElement>>[0],
  'initialOffset' | 'initialMeasurementsCache'
>;

// Navigation panels unmount on mobile room opens and when another panel takes
// their place, so their position must outlive the virtualizer.
const navScrollMemory = new Map<string, NavScrollMemory>();

export const makeNavScrollMemoryKey = (userId: string, navId: string): string =>
  `${userId}|${navId}`;

/**
 * A navigation list virtualizer that reopens where the reader left it.
 * A virtualizer scrolls its newly attached viewport to its initial offset,
 * and restored measurements keep rows it had measured from settling again.
 * The key must stay the same for the component's lifetime.
 */
export function useNavVirtualizer<TScrollElement extends Element, TItemElement extends Element>(
  memoryKey: string,
  options: NavVirtualizerOptions<TScrollElement, TItemElement>
) {
  const restoredRef = useRef(navScrollMemory.get(memoryKey));
  const virtualizer = useVirtualizer<TScrollElement, TItemElement>({
    ...options,
    initialOffset: restoredRef.current?.scrollOffset ?? 0,
    initialMeasurementsCache: restoredRef.current?.measurements,
  });

  useLayoutEffect(() => {
    // Sizes measured from here on are newer, so a list that empties and
    // refills must not be seeded from the snapshot again.
    restoredRef.current = undefined;
    // Content that now fits clamps the restore to 0 without a scroll event,
    // which would leave the virtualizer rendering rows for the old offset.
    const { scrollElement, scrollOffset } = virtualizer;
    if (scrollElement && Math.abs(scrollElement.scrollTop - (scrollOffset ?? 0)) > 1) {
      scrollElement.dispatchEvent(new Event('scroll'));
    }
  }, [virtualizer]);

  useLayoutEffect(
    () => () => {
      navScrollMemory.set(memoryKey, {
        scrollOffset: virtualizer.scrollOffset ?? 0,
        measurements: virtualizer.takeSnapshot(),
      });
    },
    [memoryKey, virtualizer]
  );

  return virtualizer;
}
