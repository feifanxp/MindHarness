import { defaultRangeExtractor, type Range, type Virtualizer } from '@tanstack/react-virtual';

/** Keep real content ready for a fast swipe, even across zero-height edits. */
export const threadScrollRange = (
  range: Range,
  virtualizer: Virtualizer<HTMLDivElement, Element>
): number[] => {
  const height = virtualizer.scrollRect?.height ?? virtualizer.options.initialRect?.height ?? 0;
  if (height <= 0) return defaultRangeExtractor(range);
  // virtual-core computes these before invoking the range extractor.
  const measurements = virtualizer.measurementsCache;
  const firstVisible = measurements[range.startIndex];
  const lastVisible = measurements[range.endIndex];
  if (!firstVisible || !lastVisible) return defaultRangeExtractor(range);

  // Binary-search pixel boundaries instead of walking potentially thousands
  // of invisible relation events. All coordinates include the same ledger
  // scrollMargin, so a prepend/fold cannot shift this buffer out of alignment.
  const buffer = height * 2;
  const first = virtualizer.getVirtualItemForOffset(firstVisible.start - buffer);
  const last = virtualizer.getVirtualItemForOffset(lastVisible.end + buffer);
  const start = Math.min(range.startIndex, first?.index ?? 0);
  const end = Math.max(range.endIndex, last?.index ?? range.count - 1);
  // Keep indices contiguous: skipped relations still advance render context.
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
};
