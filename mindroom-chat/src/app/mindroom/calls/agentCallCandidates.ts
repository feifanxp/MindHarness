import { KnownMembership, type Room, type RoomMember } from 'matrix-js-sdk';
import { isMindroomAgentUserIdForViewer } from '../matrix/agentIdentity';
import { hasMindroomVoiceCallsPresence } from './agentCall';

export type AgentCallCandidate = { userId: string; displayName: string };

/** Joined same-homeserver MindRoom agents whose presence advertises voice calls, by display name. */
export const getAgentCallCandidates = (
  members: RoomMember[],
  viewerUserId: string | undefined,
  presenceStatusFor: (userId: string) => string | undefined
): AgentCallCandidate[] =>
  members
    .filter(
      (member) =>
        member.membership === KnownMembership.Join &&
        isMindroomAgentUserIdForViewer(member.userId, viewerUserId) &&
        hasMindroomVoiceCallsPresence(presenceStatusFor(member.userId))
    )
    .map((member) => ({ userId: member.userId, displayName: member.name }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

/** Candidates who sent the thread root or a loaded reply; reads every thread event, not a capped participant list. */
export const keepThreadSenders = (
  candidates: AgentCallCandidate[],
  room: Room,
  threadId: string
): AgentCallCandidate[] => {
  const thread = room.getThread(threadId);
  const events = [thread?.rootEvent ?? room.findEventById(threadId), ...(thread?.events ?? [])];
  const senders = new Set(events.map((event) => event?.getSender()));
  return candidates.filter(({ userId }) => senders.has(userId));
};
