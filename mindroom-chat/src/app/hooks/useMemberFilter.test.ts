import { RoomMember } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { Membership } from '../../types/matrix/room';
import { MembershipFilter } from './useMemberFilter';

const memberWithMembership = (membership: Membership): RoomMember => ({ membership } as RoomMember);

describe('MembershipFilter', () => {
  it('matches only pending knock memberships as join requests', () => {
    expect(MembershipFilter.filterKnocked(memberWithMembership(Membership.Knock))).toBe(true);
    expect(MembershipFilter.filterKnocked(memberWithMembership(Membership.Invite))).toBe(false);
    expect(MembershipFilter.filterKnocked(memberWithMembership(Membership.Join))).toBe(false);
    expect(MembershipFilter.filterKnocked(memberWithMembership(Membership.Leave))).toBe(false);
    expect(MembershipFilter.filterKnocked(memberWithMembership(Membership.Ban))).toBe(false);
  });
});
