import { RelationType } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { getMessageRelation } from './composeMessageRelation';

describe('getMessageRelation', () => {
  it('returns undefined when there is no reply or thread context', () => {
    expect(getMessageRelation()).toBeUndefined();
  });

  it('returns only reply fallback relation for plain reply', () => {
    expect(getMessageRelation('$reply')).toEqual({
      'm.in_reply_to': {
        event_id: '$reply',
      },
    });
  });

  it('returns thread relation with fallback when only thread context exists', () => {
    expect(getMessageRelation(undefined, undefined, '$thread')).toEqual({
      'm.in_reply_to': {
        event_id: '$thread',
      },
      event_id: '$thread',
      rel_type: RelationType.Thread,
      is_falling_back: true,
    });
  });

  it('keeps reply target while attaching thread relation from context', () => {
    expect(getMessageRelation('$reply', undefined, '$thread')).toEqual({
      'm.in_reply_to': {
        event_id: '$reply',
      },
      event_id: '$thread',
      rel_type: RelationType.Thread,
      is_falling_back: false,
    });
  });

  it('prefers thread relation root from reply relation over context thread id', () => {
    expect(
      getMessageRelation(
        '$reply',
        {
          rel_type: RelationType.Thread,
          event_id: '$thread-from-reply',
        },
        '$thread-from-context'
      )
    ).toEqual({
      'm.in_reply_to': {
        event_id: '$reply',
      },
      event_id: '$thread-from-reply',
      rel_type: RelationType.Thread,
      is_falling_back: false,
    });
  });

  it('can suppress thread relation while preserving a normal reply', () => {
    expect(
      getMessageRelation(
        '$reply',
        {
          rel_type: RelationType.Thread,
          event_id: '$thread-from-reply',
        },
        '$thread-from-context',
        { allowThreadRelation: false }
      )
    ).toEqual({
      'm.in_reply_to': {
        event_id: '$reply',
      },
    });
  });
});
