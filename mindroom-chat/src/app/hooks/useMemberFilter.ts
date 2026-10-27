import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { RoomMember } from 'matrix-js-sdk';
import { Membership } from '../../types/matrix/room';

export const MembershipFilter = {
  filterJoined: (m: RoomMember) => m.membership === Membership.Join,
  filterKnocked: (m: RoomMember) => m.membership === Membership.Knock,
  filterInvited: (m: RoomMember) => m.membership === Membership.Invite,
  filterLeaved: (m: RoomMember) =>
    m.membership === Membership.Leave &&
    m.events.member?.getStateKey() === m.events.member?.getSender(),
  filterKicked: (m: RoomMember) =>
    m.membership === Membership.Leave &&
    m.events.member?.getStateKey() !== m.events.member?.getSender(),
  filterBanned: (m: RoomMember) => m.membership === Membership.Ban,
};

export type MembershipFilterFn = (m: RoomMember) => boolean;

export type MembershipFilterItem = {
  name: string;
  filterFn: MembershipFilterFn;
};

export const useMembershipFilterMenu = (): MembershipFilterItem[] => {
  const { t } = useTranslation();
  return useMemo(
    () => [
      {
        name: t('sharedUi.memberFilters.joined'),
        filterFn: MembershipFilter.filterJoined,
      },
      {
        name: t('sharedUi.memberFilters.invited'),
        filterFn: MembershipFilter.filterInvited,
      },
      {
        name: t('sharedUi.memberFilters.left'),
        filterFn: MembershipFilter.filterLeaved,
      },
      {
        name: t('sharedUi.memberFilters.kicked'),
        filterFn: MembershipFilter.filterKicked,
      },
      {
        name: t('sharedUi.memberFilters.banned'),
        filterFn: MembershipFilter.filterBanned,
      },
    ],
    [t]
  );
};

export const useMembershipFilter = (
  index: number,
  membershipFilter: MembershipFilterItem[]
): MembershipFilterItem => {
  const filter = membershipFilter[index] ?? membershipFilter[0];
  return filter;
};
