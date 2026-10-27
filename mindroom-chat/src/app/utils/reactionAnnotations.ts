import { MatrixEvent } from 'matrix-js-sdk';
import type { Relations } from 'matrix-js-sdk/lib/models/relations';

export type AnnotationEntry = [string, Set<MatrixEvent>];

export const getActiveAnnotationsByKey = (
  relations: Relations | undefined
): AnnotationEntry[] => {
  const groupedAnnotations =
    (relations?.getSortedAnnotationsByKey() as [string, Set<MatrixEvent>][] | null | undefined) ??
    [];

  return groupedAnnotations.reduce<AnnotationEntry[]>((entries, [key, events]) => {
    if (typeof key !== 'string') return entries;

    const activeEvents = Array.from(events).filter((event) => !event.isRedacted());
    if (activeEvents.length === 0) return entries;

    entries.push([key, new Set(activeEvents)]);
    return entries;
  }, []);
};

export const getActiveEventsForAnnotationKey = (
  relations: Relations | undefined,
  key: string
): MatrixEvent[] => {
  const [, events] = getActiveAnnotationsByKey(relations).find(([annotationKey]) => annotationKey === key) ?? [];
  return events ? Array.from(events) : [];
};
