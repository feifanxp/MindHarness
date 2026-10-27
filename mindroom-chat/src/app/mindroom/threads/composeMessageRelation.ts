import { IEventRelation, RelationType } from 'matrix-js-sdk';

type MessageRelation = {
  'm.in_reply_to'?: {
    event_id: string;
  };
  event_id?: string;
  rel_type?: RelationType;
  is_falling_back?: boolean;
};

export const getMessageRelation = (
  replyEventId?: string,
  replyRelation?: IEventRelation,
  threadId?: string,
  options: { allowThreadRelation?: boolean } = {}
): MessageRelation | undefined => {
  const allowThreadRelation = options.allowThreadRelation ?? true;
  const relation: MessageRelation = {};
  const hasExplicitReply = typeof replyEventId === 'string' && replyEventId.length > 0;

  if (replyEventId) {
    relation['m.in_reply_to'] = {
      event_id: replyEventId,
    };
  }

  let threadRootId: string | undefined;
  if (allowThreadRelation) {
    threadRootId =
      replyRelation?.rel_type === RelationType.Thread &&
      typeof replyRelation.event_id === 'string' &&
      replyRelation.event_id.length > 0
        ? replyRelation.event_id
        : threadId;
  }

  if (threadRootId) {
    relation.event_id = threadRootId;
    relation.rel_type = RelationType.Thread;
    relation.is_falling_back = !hasExplicitReply;

    if (!relation['m.in_reply_to']) {
      relation['m.in_reply_to'] = {
        event_id: threadRootId,
      };
    }
  }

  return Object.keys(relation).length > 0 ? relation : undefined;
};
