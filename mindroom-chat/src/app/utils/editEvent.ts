import { IEvent, MatrixEvent, RelationType } from 'matrix-js-sdk';

type StructuredCloneGlobal = typeof globalThis & {
  structuredClone?: <T>(value: T) => T;
};

export const cloneRawEvent = <TRawEvent extends Partial<IEvent>>(
  rawEvent: TRawEvent
): TRawEvent => {
  const g = globalThis as StructuredCloneGlobal;
  if (typeof g.structuredClone === 'function') {
    return g.structuredClone(rawEvent);
  }

  return JSON.parse(JSON.stringify(rawEvent)) as TRawEvent;
};

const isValidSerializedRelationEvent = (
  relationEvent: unknown
): relationEvent is Partial<IEvent> => {
  if (!relationEvent || typeof relationEvent !== 'object' || Array.isArray(relationEvent)) {
    return false;
  }

  const rawRelationEvent = relationEvent as Partial<IEvent>;
  return (
    typeof rawRelationEvent.event_id === 'string' &&
    rawRelationEvent.event_id.length > 0 &&
    typeof rawRelationEvent.origin_server_ts === 'number' &&
    Number.isFinite(rawRelationEvent.origin_server_ts) &&
    rawRelationEvent.origin_server_ts > 0
  );
};

const getRawSerializedRelationEvent = (
  mEvent: MatrixEvent,
  relationType: RelationType
): Partial<IEvent> | undefined => {
  const relations = mEvent.getUnsigned()?.['m.relations'];
  if (!relations || typeof relations !== 'object' || Array.isArray(relations)) return undefined;

  const relationEvent = (relations as Record<string, unknown>)[relationType];
  return isValidSerializedRelationEvent(relationEvent) ? relationEvent : undefined;
};

export const getSerializedRelationEvent = (
  mEvent: MatrixEvent,
  relationType: RelationType
): MatrixEvent | undefined => {
  const relationEvent = getRawSerializedRelationEvent(mEvent, relationType);
  return relationEvent ? new MatrixEvent(cloneRawEvent(relationEvent)) : undefined;
};

export const getSerializedReplacementEvent = (mEvent: MatrixEvent): MatrixEvent | undefined =>
  getSerializedRelationEvent(mEvent, RelationType.Replace);

/**
 * The bundled replacement with only its event, content and `m.new_content`
 * copied, the objects getEditedEvent fills with fallback metadata. Far cheaper
 * than getSerializedReplacementEvent's deep copy of a large streamed edit, for
 * callers that only pass it to getEditedEvent; nested values stay shared.
 */
export const getShallowSerializedReplacementEvent = (
  mEvent: MatrixEvent
): MatrixEvent | undefined => {
  const relationEvent = getRawSerializedRelationEvent(mEvent, RelationType.Replace);
  if (!relationEvent) return undefined;

  const content = relationEvent.content ?? {};
  const newContent = content['m.new_content'];
  return new MatrixEvent({
    ...relationEvent,
    content:
      newContent && typeof newContent === 'object' && !Array.isArray(newContent)
        ? { ...content, 'm.new_content': { ...newContent } }
        : content,
  });
};

export const isSameSenderEditEvent = (
  targetEvent: MatrixEvent,
  editEvent: MatrixEvent | undefined
): editEvent is MatrixEvent => !!editEvent && editEvent.getSender() === targetEvent.getSender();
