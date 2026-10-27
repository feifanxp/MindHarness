import type { MatrixEvent } from 'matrix-js-sdk';

export const getThreadRootReplyCount = (threadRootEvent?: MatrixEvent): number | undefined => {
  if (!threadRootEvent) return undefined;
  const threadMeta = threadRootEvent.getUnsigned()?.['m.relations']?.['m.thread'] as
    | { count?: unknown; c?: unknown }
    | undefined;
  if (typeof threadMeta?.count === 'number') return threadMeta.count;
  if (typeof threadMeta?.c === 'number') return threadMeta.c;
  return undefined;
};
