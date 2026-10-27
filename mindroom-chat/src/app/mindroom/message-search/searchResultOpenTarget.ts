import { IEventWithRoomId, RelationType } from 'matrix-js-sdk';

export type SearchResultOpenTarget = {
  mainEventId: string;
  threadRootId?: string;
};

export const getSearchResultOpenTarget = (
  event: Pick<IEventWithRoomId, 'content' | 'event_id'>
): SearchResultOpenTarget => {
  const relation = event.content['m.relates_to'];

  return {
    mainEventId:
      relation?.rel_type === RelationType.Replace && relation.event_id
        ? relation.event_id
        : event.event_id,
    threadRootId:
      relation?.rel_type === RelationType.Thread && relation.event_id
        ? relation.event_id
        : undefined,
  };
};
