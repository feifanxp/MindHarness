import React, {
  ChangeEventHandler,
  MouseEventHandler,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Avatar,
  Badge,
  Box,
  Chip,
  Icon,
  IconButton,
  Icons,
  Input,
  PopOut,
  RectCords,
  Spinner,
  Text,
  Tooltip,
  TooltipProvider,
  config,
} from 'folds';
import { MatrixClient, Room, RoomMember } from 'matrix-js-sdk';
import { useVirtualizer } from '@tanstack/react-virtual';
import classNames from 'classnames';

import { useTranslation } from 'react-i18next';
import { MenuItem } from '../../components/glass/GlassPrimitives';
import * as css from './MembersDrawer.css';
import { PageNavContent, PageNavHeader } from '../../components/page/Page';
import { PageScrollToTop } from '../../components/page/style.css';
import { useElementSizeObserver } from '../../hooks/useElementSizeObserver';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { UseStateProvider } from '../../components/UseStateProvider';
import {
  SearchItemStrGetter,
  UseAsyncSearchOptions,
  useAsyncSearch,
} from '../../hooks/useAsyncSearch';
import { useDebounce } from '../../hooks/useDebounce';
import { TypingIndicator } from '../../components/typing-indicator';
import { getMemberDisplayName, getMemberSearchStr } from '../../utils/room';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { useSetting } from '../../state/hooks/settings';
import { useMembersDrawer } from '../../mindroom/sidebar/useMembersDrawer';
import { settingsAtom } from '../../state/settings';
import { millify } from '../../plugins/millify';
import { ScrollTopContainer } from '../../components/scroll-top-container';
import { UserAvatar } from '../../components/user-avatar';
import { useRoomTypingMember } from '../../hooks/useRoomTypingMembers';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import {
  MembershipFilter,
  useMembershipFilter,
  useMembershipFilterMenu,
} from '../../hooks/useMemberFilter';
import {
  MemberSort,
  useMemberPowerSort,
  useMemberSort,
  useMemberSortMenu,
} from '../../hooks/useMemberSort';
import { useGetMemberPowerLevel, usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { MembershipFilterMenu } from '../../components/MembershipFilterMenu';
import { MemberSortMenu } from '../../components/MemberSortMenu';
import { useOpenUserRoomProfile, useUserRoomProfileState } from '../../state/hooks/userRoomProfile';
import { useSpaceOptionally } from '../../hooks/useSpace';
import { ContainerColor } from '../../styles/ContainerColor.css';
import { useFlattenPowerTagMembers, useGetMemberPowerTag } from '../../hooks/useMemberPowerTag';
import { AgentVerifiedBadge } from '../../mindroom/matrix/AgentVerifiedBadge';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { InviteUserPrompt } from '../../components/invite-user-prompt';
import { useMemberPowerCompare } from '../../hooks/useMemberPowerCompare';
import { JoinRequestItem } from './JoinRequestItem';

type MemberDrawerHeaderProps = {
  room: Room;
  canInvite: boolean;
  onShowInvited: () => void;
};
function MemberDrawerHeader({ room, canInvite, onShowInvited }: MemberDrawerHeaderProps) {
  const { t } = useTranslation();
  const [, setPeopleDrawer] = useMembersDrawer();
  const [invitePrompt, setInvitePrompt] = useState(false);
  const invitedCount = room.getInvitedMemberCount();

  return (
    <PageNavHeader>
      {invitePrompt && <InviteUserPrompt room={room} requestClose={() => setInvitePrompt(false)} />}
      <Box grow="Yes" alignItems="Center" gap="200">
        {/* The default 266 px drawer cannot fit both counts and two buttons on one line. */}
        <Box grow="Yes" direction="Column" alignItems="Start">
          <Text
            className={css.MembersHeaderCount}
            title={t('featureUi.room.membersDrawer.memberCount', {
              count: room.getJoinedMemberCount(),
            })}
            size="H5"
            truncate
          >
            {t('featureUi.room.membersDrawer.formattedMemberCount', {
              count: room.getJoinedMemberCount(),
              formattedCount: millify(room.getJoinedMemberCount()),
            })}
          </Text>
          {invitedCount > 0 && (
            <Chip
              className={classNames(css.MembersHeaderControl, css.MembersHeaderInvited)}
              variant="Background"
              size="400"
              radii="300"
              onClick={onShowInvited}
            >
              <Text size="T200" truncate>
                {t('featureUi.room.membersDrawer.invitedCount', { count: invitedCount })}
              </Text>
            </Chip>
          )}
        </Box>
        <Box shrink="No" alignItems="Center" gap="100">
          <TooltipProvider
            position="Bottom"
            align="End"
            offset={4}
            tooltip={
              <Tooltip>
                <Text>{t('featureUi.room.membersDrawer.invite')}</Text>
              </Tooltip>
            }
          >
            {(triggerRef) => (
              <IconButton
                ref={triggerRef}
                className={css.MembersHeaderControl}
                aria-label={t('featureUi.room.membersDrawer.invitePeople')}
                aria-pressed={invitePrompt}
                disabled={!canInvite}
                variant="Background"
                onClick={() => setInvitePrompt(true)}
              >
                <Icon src={Icons.UserPlus} />
              </IconButton>
            )}
          </TooltipProvider>
          <TooltipProvider
            position="Bottom"
            align="End"
            offset={4}
            tooltip={
              <Tooltip>
                <Text>{t('featureUi.room.membersDrawer.close')}</Text>
              </Tooltip>
            }
          >
            {(triggerRef) => (
              <IconButton
                ref={triggerRef}
                className={css.MembersHeaderControl}
                variant="Background"
                onClick={() => setPeopleDrawer(false)}
                aria-label={t('featureUi.room.membersDrawer.close')}
              >
                <Icon src={Icons.Cross} />
              </IconButton>
            )}
          </TooltipProvider>
        </Box>
      </Box>
    </PageNavHeader>
  );
}

type MemberItemProps = {
  mx: MatrixClient;
  useAuthentication: boolean;
  room: Room;
  member: RoomMember;
  onClick: MouseEventHandler<HTMLButtonElement>;
  pressed?: boolean;
  typing?: boolean;
};
function MemberItem({
  mx,
  useAuthentication,
  room,
  member,
  onClick,
  pressed,
  typing,
}: MemberItemProps) {
  const name =
    getMemberDisplayName(room, member.userId) ?? getMxIdLocalPart(member.userId) ?? member.userId;
  const avatarMxcUrl = member.getMxcAvatarUrl();
  const avatarUrl = avatarMxcUrl
    ? mxcUrlToHttp(mx, avatarMxcUrl, useAuthentication, 100, 100, 'crop')
    : undefined;

  return (
    <MenuItem
      style={{ padding: `0 ${config.space.S200}` }}
      aria-pressed={pressed}
      data-user-id={member.userId}
      variant="Background"
      radii="400"
      onClick={onClick}
      before={
        <Avatar size="200">
          <UserAvatar
            userId={member.userId}
            src={avatarUrl ?? undefined}
            alt={name}
            renderFallback={() => <Icon size="50" src={Icons.User} filled />}
          />
        </Avatar>
      }
      after={
        typing && (
          <Badge size="300" variant="Secondary" fill="Soft" radii="Pill" outlined>
            <TypingIndicator size="300" />
          </Badge>
        )
      }
    >
      <Box grow="Yes" alignItems="Center" gap="100">
        <Text size="T400" truncate>
          {name}
        </Text>
        <AgentVerifiedBadge userId={member.userId} />
      </Box>
    </MenuItem>
  );
}

const SEARCH_OPTIONS: UseAsyncSearchOptions = {
  limit: 1000,
  matchOptions: {
    contain: true,
  },
};

const mxIdToName = (mxId: string) => getMxIdLocalPart(mxId) ?? mxId;
const getRoomMemberStr: SearchItemStrGetter<RoomMember> = (m, query) =>
  getMemberSearchStr(m, query, mxIdToName);

type MembersDrawerProps = {
  room: Room;
  members: RoomMember[];
};
export function MembersDrawer({ room, members }: MembersDrawerProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollTopAnchorRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const memberListRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  useElementSizeObserver(
    useCallback(() => contentRef.current, []),
    useCallback(() => {
      const scroll = scrollRef.current;
      const list = memberListRef.current;
      if (scroll && list) {
        // Include the sticky header and filters in the virtualizer's scroll coordinates.
        setScrollMargin(
          list.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop
        );
      }
    }, [])
  );
  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);
  const getPowerTag = useGetMemberPowerTag(room, creators, powerLevels);
  const getPowerLevel = useGetMemberPowerLevel(powerLevels);
  const permissions = useRoomPermissions(creators, powerLevels);
  const myUserId = mx.getSafeUserId();
  const canInvite = permissions.action('invite', myUserId);
  const canKick = permissions.action('kick', myUserId);
  const canReviewJoinRequests = canInvite || canKick;
  const { hasMorePower } = useMemberPowerCompare(creators, powerLevels);

  const fetchingMembers = members.length < room.getJoinedMemberCount();
  const openUserRoomProfile = useOpenUserRoomProfile();
  const space = useSpaceOptionally();
  const openProfileUserId = useUserRoomProfileState()?.userId;

  const baseMembershipFilterMenu = useMembershipFilterMenu();
  const joinRequestCount = useMemo(
    () => members.filter(MembershipFilter.filterKnocked).length,
    [members]
  );
  const membershipFilterMenu = useMemo(
    () =>
      canReviewJoinRequests
        ? [
            ...baseMembershipFilterMenu,
            {
              name: t('featureUi.room.membersDrawer.requestCount', {
                count: joinRequestCount,
              }),
              filterFn: MembershipFilter.filterKnocked,
            },
          ]
        : baseMembershipFilterMenu,
    [baseMembershipFilterMenu, canReviewJoinRequests, joinRequestCount, t]
  );
  const sortFilterMenu = useMemberSortMenu();
  const [sortFilterIndex, setSortFilterIndex] = useSetting(settingsAtom, 'memberSortFilterIndex');
  const membershipFilterTouchedRef = useRef(false);
  const previousJoinRequestCountRef = useRef(joinRequestCount);
  const [membershipFilterIndex, setMembershipFilterIndex] = useState(() =>
    canReviewJoinRequests && joinRequestCount > 0 ? membershipFilterMenu.length - 1 : 0
  );
  useEffect(() => {
    const previousJoinRequestCount = previousJoinRequestCountRef.current;
    previousJoinRequestCountRef.current = joinRequestCount;
    if (
      !membershipFilterTouchedRef.current &&
      canReviewJoinRequests &&
      previousJoinRequestCount === 0 &&
      joinRequestCount > 0
    ) {
      setMembershipFilterIndex(membershipFilterMenu.length - 1);
    }
  }, [canReviewJoinRequests, joinRequestCount, membershipFilterMenu.length]);
  const selectedMembershipFilterIndex = membershipFilterMenu[membershipFilterIndex]
    ? membershipFilterIndex
    : 0;
  useEffect(() => {
    if (selectedMembershipFilterIndex !== membershipFilterIndex) {
      setMembershipFilterIndex(selectedMembershipFilterIndex);
    }
  }, [membershipFilterIndex, selectedMembershipFilterIndex]);

  const showInvited = () => {
    membershipFilterTouchedRef.current = true;
    setMembershipFilterIndex(
      membershipFilterMenu.findIndex((item) => item.filterFn === MembershipFilter.filterInvited)
    );
  };

  const membershipFilter = useMembershipFilter(selectedMembershipFilterIndex, membershipFilterMenu);
  const showingJoinRequests = membershipFilter.filterFn === MembershipFilter.filterKnocked;
  const memberSort = useMemberSort(sortFilterIndex, sortFilterMenu);
  const memberPowerSort = useMemberPowerSort(creators, getPowerLevel);

  const typingMembers = useRoomTypingMember(room.roomId);

  const filteredMembers = useMemo(() => {
    const matchingMembers = members.filter(membershipFilter.filterFn);
    if (showingJoinRequests) return matchingMembers.sort(MemberSort.NewestFirst);
    return matchingMembers.sort(memberSort.sortFn).sort(memberPowerSort);
  }, [members, membershipFilter, showingJoinRequests, memberSort, memberPowerSort]);

  const [result, search, resetSearch] = useAsyncSearch(
    filteredMembers,
    getRoomMemberStr,
    SEARCH_OPTIONS
  );
  if (!result && searchInputRef.current?.value) search(searchInputRef.current.value);

  const processMembers = result ? result.items : filteredMembers;

  const taggedMembers = useFlattenPowerTagMembers(processMembers, getPowerTag);
  const PLTagOrRoomMember = showingJoinRequests ? processMembers : taggedMembers;

  const virtualizer = useVirtualizer({
    count: PLTagOrRoomMember.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (showingJoinRequests ? 164 : 40),
    overscan: 10,
    scrollMargin,
  });

  const handleSearchChange: ChangeEventHandler<HTMLInputElement> = useDebounce(
    useCallback(
      (evt) => {
        if (evt.target.value) search(evt.target.value);
        else resetSearch();
      },
      [search, resetSearch]
    ),
    { wait: 200 }
  );

  const handleMemberClick: MouseEventHandler<HTMLButtonElement> = (evt) => {
    const btn = evt.currentTarget as HTMLButtonElement;
    const userId = btn.getAttribute('data-user-id');
    if (!userId) return;
    openUserRoomProfile(room.roomId, space?.roomId, userId, btn.getBoundingClientRect(), 'Left');
  };

  return (
    <Box
      className={classNames(css.MembersDrawer, ContainerColor({ variant: 'Background' }))}
      shrink="No"
      direction="Column"
    >
      <Box className={css.MemberDrawerContentBase} grow="Yes">
        <PageNavContent
          scrollRef={scrollRef}
          header={
            <MemberDrawerHeader room={room} canInvite={canInvite} onShowInvited={showInvited} />
          }
        >
          <Box ref={contentRef} direction="Column" gap="200">
            <Box ref={scrollTopAnchorRef} direction="Column" gap="200">
              <Box alignItems="Center" justifyContent="SpaceBetween" gap="200">
                <UseStateProvider initial={undefined}>
                  {(anchor: RectCords | undefined, setAnchor) => (
                    <PopOut
                      anchor={anchor}
                      position="Bottom"
                      align="Start"
                      offset={4}
                      content={
                        <MembershipFilterMenu
                          items={membershipFilterMenu}
                          selected={selectedMembershipFilterIndex}
                          onSelect={(index) => {
                            membershipFilterTouchedRef.current = true;
                            setMembershipFilterIndex(index);
                          }}
                          requestClose={() => setAnchor(undefined)}
                        />
                      }
                    >
                      <Chip
                        onClick={
                          ((evt) =>
                            setAnchor(
                              evt.currentTarget.getBoundingClientRect()
                            )) as MouseEventHandler<HTMLButtonElement>
                        }
                        variant="Background"
                        size="400"
                        radii="300"
                        before={<Icon src={Icons.Filter} size="50" />}
                      >
                        <Text size="T200">{membershipFilter.name}</Text>
                      </Chip>
                    </PopOut>
                  )}
                </UseStateProvider>
                {!showingJoinRequests && (
                  <UseStateProvider initial={undefined}>
                    {(anchor: RectCords | undefined, setAnchor) => (
                      <PopOut
                        anchor={anchor}
                        position="Bottom"
                        align="End"
                        offset={4}
                        content={
                          <MemberSortMenu
                            selected={sortFilterIndex}
                            onSelect={setSortFilterIndex}
                            requestClose={() => setAnchor(undefined)}
                          />
                        }
                      >
                        <Chip
                          onClick={
                            ((evt) =>
                              setAnchor(
                                evt.currentTarget.getBoundingClientRect()
                              )) as MouseEventHandler<HTMLButtonElement>
                          }
                          variant="Background"
                          size="400"
                          radii="300"
                          after={<Icon src={Icons.Sort} size="50" />}
                        >
                          <Text size="T200">{memberSort.name}</Text>
                        </Chip>
                      </PopOut>
                    )}
                  </UseStateProvider>
                )}
              </Box>
              <Box direction="Column" gap="100">
                <Input
                  ref={searchInputRef}
                  onChange={handleSearchChange}
                  style={{ paddingInlineEnd: config.space.S200 }}
                  placeholder={t('featureUi.room.membersDrawer.typeName')}
                  variant="Surface"
                  size="400"
                  radii="400"
                  before={<Icon size="50" src={Icons.Search} />}
                  after={
                    result && (
                      <Chip
                        variant={result.items.length > 0 ? 'Success' : 'Critical'}
                        size="400"
                        radii="Pill"
                        aria-pressed
                        onClick={() => {
                          if (searchInputRef.current) {
                            searchInputRef.current.value = '';
                            searchInputRef.current.focus();
                          }
                          resetSearch();
                        }}
                        after={<Icon size="50" src={Icons.Cross} />}
                      >
                        <Text size="B300">
                          {result.items.length === 0
                            ? t('featureUi.room.membersDrawer.noResults')
                            : t('featureUi.room.membersDrawer.resultCount', {
                                count: result.items.length,
                              })}
                        </Text>
                      </Chip>
                    )
                  }
                />
              </Box>
            </Box>

            <ScrollTopContainer
              className={PageScrollToTop}
              scrollRef={scrollRef}
              anchorRef={scrollTopAnchorRef}
              respectScrollPadding
            >
              <IconButton
                onClick={() => virtualizer.scrollToOffset(0)}
                variant="Surface"
                radii="Pill"
                outlined
                size="300"
                aria-label={t('featureUi.room.membersDrawer.scrollToTop')}
              >
                <Icon src={Icons.ChevronTop} size="300" />
              </IconButton>
            </ScrollTopContainer>

            {!fetchingMembers && !result && processMembers.length === 0 && (
              <Text style={{ padding: config.space.S300 }} align="Center">
                {showingJoinRequests
                  ? t('featureUi.room.membersDrawer.noPendingJoinRequests')
                  : t('featureUi.room.membersDrawer.noMembersForFilter', {
                      filter: membershipFilter.name,
                    })}
              </Text>
            )}

            <Box direction="Column" gap="100">
              <div
                ref={memberListRef}
                style={{
                  position: 'relative',
                  height: virtualizer.getTotalSize(),
                }}
              >
                {virtualizer.getVirtualItems().map((vItem) => {
                  const tagOrMember = PLTagOrRoomMember[vItem.index];
                  if (!('userId' in tagOrMember)) {
                    return (
                      <Text
                        style={{
                          transform: `translateY(${vItem.start - scrollMargin}px)`,
                        }}
                        data-index={vItem.index}
                        ref={virtualizer.measureElement}
                        key={`${room.roomId}-${vItem.index}`}
                        className={classNames(css.MembersGroupLabel, css.DrawerVirtualItem)}
                        size="L400"
                      >
                        {tagOrMember.name}
                      </Text>
                    );
                  }

                  const memberEvent = tagOrMember.events.member;
                  return (
                    <div
                      style={{
                        transform: `translateY(${vItem.start - scrollMargin}px)`,
                      }}
                      className={css.DrawerVirtualItem}
                      data-index={vItem.index}
                      key={`${room.roomId}-${tagOrMember.userId}-${
                        showingJoinRequests
                          ? memberEvent?.getId() ?? memberEvent?.getTs() ?? ''
                          : ''
                      }`}
                      ref={virtualizer.measureElement}
                    >
                      {showingJoinRequests ? (
                        <JoinRequestItem
                          room={room}
                          member={tagOrMember}
                          canApprove={canInvite}
                          canDecline={canKick && hasMorePower(myUserId, tagOrMember.userId)}
                        />
                      ) : (
                        <MemberItem
                          mx={mx}
                          useAuthentication={useAuthentication}
                          room={room}
                          member={tagOrMember}
                          onClick={handleMemberClick}
                          pressed={openProfileUserId === tagOrMember.userId}
                          typing={typingMembers.some(
                            (receipt) => receipt.userId === tagOrMember.userId
                          )}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </Box>

            {fetchingMembers && (
              <Box justifyContent="Center">
                <Spinner />
              </Box>
            )}
          </Box>
        </PageNavContent>
      </Box>
    </Box>
  );
}
