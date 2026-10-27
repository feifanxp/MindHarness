import { ResultGroup, ResultItem } from './useMessageSearch';

export type MessageSearchRow =
  | {
      kind: 'room-header';
      key: string;
      roomId: string;
    }
  | {
      kind: 'item';
      key: string;
      roomId: string;
      item: ResultItem;
    };

export const MESSAGE_SEARCH_FALLBACK_ROW_LIMIT = 24;

export const flattenMessageSearchRows = (groups: ResultGroup[]): MessageSearchRow[] =>
  groups.flatMap((group) => {
    const headerRow: MessageSearchRow = {
      kind: 'room-header',
      key: `header:${group.roomId}`,
      roomId: group.roomId,
    };

    const itemRows: MessageSearchRow[] = group.items.map((item, index) => ({
      kind: 'item',
      key: `item:${group.roomId}:${item.event.event_id ?? index}`,
      roomId: group.roomId,
      item,
    }));

    return [headerRow, ...itemRows];
  });
