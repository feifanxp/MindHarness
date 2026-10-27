import { MatrixEvent, type Room, type RoomMember } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { getAgentCallCandidates, keepThreadSenders } from './agentCallCandidates';

const VIEWER = '@alice:mindroom.test';
const VOICE_CALLS_STATUS = '🤖 Model: openai/gpt-5.5 | 📞 Voice calls';

const member = (userId: string, name: string, membership = 'join') =>
  ({ userId, name, membership } as RoomMember);

describe('getAgentCallCandidates', () => {
  it('keeps only joined same-homeserver agents that advertise voice calls', () => {
    const statuses: Record<string, string> = {
      '@bob:mindroom.test': VOICE_CALLS_STATUS,
      '@mindroom_voice:mindroom.test': VOICE_CALLS_STATUS,
      '@mindroom_invited:mindroom.test': VOICE_CALLS_STATUS,
      '@mindroom_left:mindroom.test': VOICE_CALLS_STATUS,
      '@mindroom_foreign:elsewhere.test': VOICE_CALLS_STATUS,
      '@mindroom_text:mindroom.test': '🤖 Model: openai/gpt-5.5',
    };
    const members = [
      member('@bob:mindroom.test', 'Bob'),
      member('@mindroom_voice:mindroom.test', 'Voice'),
      member('@mindroom_invited:mindroom.test', 'Invited', 'invite'),
      member('@mindroom_left:mindroom.test', 'Left', 'leave'),
      member('@mindroom_foreign:elsewhere.test', 'Foreign'),
      member('@mindroom_text:mindroom.test', 'Text only'),
      member('@mindroom_silent:mindroom.test', 'No presence'),
    ];

    expect(getAgentCallCandidates(members, VIEWER, (userId) => statuses[userId])).toEqual([
      { userId: '@mindroom_voice:mindroom.test', displayName: 'Voice' },
    ]);
  });

  it('sorts candidates by display name', () => {
    const members = [
      member('@mindroom_c:mindroom.test', 'Zeta'),
      member('@mindroom_a:mindroom.test', 'alpha'),
      member('@mindroom_b:mindroom.test', 'Beta'),
    ];

    expect(
      getAgentCallCandidates(members, VIEWER, () => VOICE_CALLS_STATUS).map(
        ({ displayName }) => displayName
      )
    ).toEqual(['alpha', 'Beta', 'Zeta']);
  });
});

describe('keepThreadSenders', () => {
  const HELPER = { userId: '@mindroom_helper:mindroom.test', displayName: 'Helper' };
  const ANALYST = { userId: '@mindroom_analyst:mindroom.test', displayName: 'Analyst' };
  const event = (sender: string) => new MatrixEvent({ type: 'm.room.message', sender });
  const room = (
    thread: { rootEvent?: MatrixEvent; events: MatrixEvent[] } | null,
    root?: MatrixEvent
  ) => ({ getThread: () => thread, findEventById: () => root } as unknown as Room);

  it('keeps only candidates who replied in the thread', () => {
    const root = event(VIEWER);
    const thread = { rootEvent: root, events: [root, event(HELPER.userId), event(VIEWER)] };

    expect(keepThreadSenders([ANALYST, HELPER], room(thread), '$root')).toEqual([HELPER]);
  });

  it('keeps nobody in a thread with only human senders', () => {
    const root = event(VIEWER);
    const thread = { rootEvent: root, events: [root, event('@bob:mindroom.test')] };

    expect(keepThreadSenders([ANALYST, HELPER], room(thread), '$root')).toEqual([]);
  });

  it('counts the root sender, also before the SDK has a thread for it', () => {
    const root = event(ANALYST.userId);

    expect(
      keepThreadSenders([ANALYST, HELPER], room({ rootEvent: root, events: [] }), '$root')
    ).toEqual([ANALYST]);
    expect(keepThreadSenders([ANALYST, HELPER], room(null, root), '$root')).toEqual([ANALYST]);
  });
});
