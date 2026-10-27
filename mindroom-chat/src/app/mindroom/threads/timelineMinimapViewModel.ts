import type { TFunction } from 'i18next';
import { EventType } from 'matrix-js-sdk';
import { isMindroomAgentMessageEvent, isMindroomAgentUserId } from '../matrix/agentIdentity';
import { getLocalizedThreadMessagePreviewText } from './threadMessagePreview';

export const TIMELINE_MINIMAP_ITEM_SPACING = 8;
export const TIMELINE_MINIMAP_MIN_ITEMS = 2;
export const TIMELINE_MINIMAP_MAX_HEIGHT_CSS = 'calc(100vh - 18rem)';

export type TimelineMinimapItem = {
  /** Event ID of the non-agent message the stripe points at. */
  id: string;
  /** Single-line preview of the non-agent message. */
  userText: string | null;
  /** Preview of the final agent reply before the next non-agent message. */
  agentText: string | null;
};

export type TimelineMinimapEvent = {
  getId(): string | undefined;
  getType(): string;
  getSender?(): string | undefined;
  getContent(): Record<string, unknown>;
  isRedacted?(): boolean;
};

export const resolveTimelineMinimapHeightStyle = (itemCount: number): string => {
  const naturalHeight = Math.max(1, (itemCount - 1) * TIMELINE_MINIMAP_ITEM_SPACING);
  return `min(${naturalHeight}px, ${TIMELINE_MINIMAP_MAX_HEIGHT_CSS})`;
};

export const resolveTimelineMinimapTopPercent = (index: number, itemCount: number): number => {
  if (itemCount <= 1) {
    return 0;
  }
  return (Math.max(0, Math.min(index, itemCount - 1)) / (itemCount - 1)) * 100;
};

export const resolveTimelineMinimapIndexFromPointer = (input: {
  itemCount: number;
  railTop: number;
  railHeight: number;
  pointerY: number;
}): number | null => {
  if (input.itemCount <= 0 || input.railHeight <= 0) {
    return null;
  }
  if (input.itemCount === 1) {
    return 0;
  }

  const progress = Math.max(0, Math.min(1, (input.pointerY - input.railTop) / input.railHeight));
  return Math.max(0, Math.min(input.itemCount - 1, Math.round(progress * (input.itemCount - 1))));
};

const compactMinimapPreview = (text: string | null | undefined): string | null => {
  const compact = text?.replace(/\s+/g, ' ').trim() ?? '';
  return compact.length > 0 ? compact : null;
};

type MinimapSourceKind = 'user' | 'agent' | 'redactedUser' | 'other';

const resolveMinimapSourceKind = (mEvent: TimelineMinimapEvent): MinimapSourceKind => {
  if (mEvent.getType() !== EventType.RoomMessage) return 'other';
  if (mEvent.isRedacted?.()) {
    // Redaction strips the content metadata, so only the sender convention is
    // left to classify. A redacted human question gets no stripe but must
    // still end the previous question's reply-pairing run.
    return isMindroomAgentUserId(mEvent.getSender?.()) ? 'other' : 'redactedUser';
  }
  return isMindroomAgentMessageEvent(mEvent) ? 'agent' : 'user';
};

const resolveMinimapPreviewText = (mEvent: TimelineMinimapEvent, t?: TFunction): string | null => {
  return compactMinimapPreview(getLocalizedThreadMessagePreviewText(mEvent.getContent(), t));
};

/**
 * One minimap stripe per rendered message that was NOT sent by a MindRoom
 * agent, each carrying its own preview plus the final agent reply that
 * arrived before the next non-agent message (mirrors the reference
 * implementation's user/assistant turn pairing).
 */
export const deriveTimelineMinimapItems = (
  events: readonly TimelineMinimapEvent[],
  t?: TFunction
): TimelineMinimapItem[] => {
  const kinds = events.map(resolveMinimapSourceKind);
  const items: TimelineMinimapItem[] = [];

  for (let index = 0; index < events.length; index += 1) {
    if (kinds[index] !== 'user') continue;

    const mEvent = events[index];
    const eventId = mEvent.getId();
    if (!eventId) continue;

    let agentText: string | null = null;
    for (let cursor = index + 1; cursor < events.length; cursor += 1) {
      if (kinds[cursor] === 'user' || kinds[cursor] === 'redactedUser') break;
      if (kinds[cursor] === 'agent') {
        agentText = resolveMinimapPreviewText(events[cursor], t) ?? agentText;
      }
    }

    items.push({
      id: eventId,
      userText: resolveMinimapPreviewText(mEvent, t),
      agentText,
    });
  }

  return items;
};
