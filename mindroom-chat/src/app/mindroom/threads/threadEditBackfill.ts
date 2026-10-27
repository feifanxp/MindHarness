import { MatrixEvent } from 'matrix-js-sdk';
import { MessageEvent } from '../../../types/matrix/room';
import { MINDROOM_TOOL_APPROVAL_EVENT } from '../messages/toolApproval';

const getThreadEditBackfillPhase = (threadTailLoaded: boolean): number =>
  threadTailLoaded ? 1 : 0;

export const hasLikelyIncompleteStreamingBody = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  if (!normalized) return false;

  return (
    normalized === 'Thinking...' ||
    normalized === 'Thinking…' ||
    normalized === 'Thinking... ⋯' ||
    normalized === 'Thinking...  ⋯' ||
    (normalized.startsWith('Thinking') &&
      (normalized.includes('...') || normalized.includes('…') || normalized.includes('⋯')))
  );
};

const likelyNeedsStreamingEditRepair = (mEvent: MatrixEvent): boolean => {
  const content = mEvent.getContent();
  return (
    hasLikelyIncompleteStreamingBody(content?.body) ||
    hasLikelyIncompleteStreamingBody(content?.formatted_body)
  );
};

export const shouldFetchThreadEditBackfill = (
  mEvent: MatrixEvent,
  attemptedEvents: WeakMap<MatrixEvent, number>,
  threadTailLoaded: boolean,
  targetedOpen: boolean
): boolean => {
  if (!threadTailLoaded) return false;
  if (!mEvent.getId()) return false;
  if (mEvent.isRedacted()) return false;

  const currentPhase = getThreadEditBackfillPhase(threadTailLoaded);
  const lastAttemptPhase = attemptedEvents.get(mEvent);
  if (typeof lastAttemptPhase === 'number' && lastAttemptPhase >= currentPhase) return false;

  const eventType = mEvent.getType();
  const supportedEventType =
    eventType === MessageEvent.RoomMessage ||
    eventType === MessageEvent.RoomMessageEncrypted ||
    eventType === MINDROOM_TOOL_APPROVAL_EVENT;
  if (!supportedEventType) return false;

  if (targetedOpen) return true;
  if (eventType === MINDROOM_TOOL_APPROVAL_EVENT) return true;
  return likelyNeedsStreamingEditRepair(mEvent);
};

export const markThreadEditBackfillAttempted = (
  mEvent: MatrixEvent,
  attemptedEvents: WeakMap<MatrixEvent, number>,
  threadTailLoaded: boolean
): void => {
  attemptedEvents.set(mEvent, getThreadEditBackfillPhase(threadTailLoaded));
};
