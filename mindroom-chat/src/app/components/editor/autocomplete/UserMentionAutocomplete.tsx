import { useTranslation } from 'react-i18next';
import React, { useEffect, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Editor } from 'slate';
import { Avatar, Icon, Icons, Text } from 'folds';
import { MatrixClient, Room, RoomMember } from 'matrix-js-sdk';
import { MenuItem } from '../../glass/GlassPrimitives';

import { AutocompleteQuery } from './autocompleteQuery';
import { AutocompleteMenu } from './AutocompleteMenu';
import { useRoomMembers } from '../../../hooks/useRoomMembers';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import {
  SearchItemStrGetter,
  UseAsyncSearchOptions,
  searchNow,
  useAsyncSearch,
} from '../../../hooks/useAsyncSearch';
import { normalize } from '../../../utils/AsyncSearch';
import { onTabPress } from '../../../utils/keyboard';
import { createMentionElement, moveCursor, replaceWithElement } from '../utils';
import { useKeyDown } from '../../../hooks/useKeyDown';
import { getMxIdLocalPart, getMxIdServer, isUserId, mxcUrlToHttp } from '../../../utils/matrix';
import { getMemberDisplayName, getMemberSearchStr } from '../../../utils/room';
import { UserAvatar } from '../../user-avatar';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { Membership } from '../../../../types/matrix/room';

type MentionAutoCompleteHandler = (userId: string, name: string) => void;

const userIdFromQueryText = (mx: MatrixClient, text: string) =>
  isUserId(`@${text}`)
    ? `@${text}`
    : `@${text}${text.endsWith(':') ? '' : ':'}${getMxIdServer(mx.getUserId() ?? '')}`;

function UnknownMentionItem({
  userId,
  name,
  handleAutocomplete,
}: {
  userId: string;
  name: string;
  handleAutocomplete: MentionAutoCompleteHandler;
}) {
  return (
    <MenuItem
      as="button"
      radii="300"
      onKeyDown={(evt: ReactKeyboardEvent<HTMLButtonElement>) =>
        onTabPress(evt, () => handleAutocomplete(userId, name))
      }
      onClick={() => handleAutocomplete(userId, name)}
      before={
        <Avatar size="200">
          <UserAvatar
            userId={userId}
            renderFallback={() => <Icon size="50" src={Icons.User} filled />}
          />
        </Avatar>
      }
    >
      <Text style={{ flexGrow: 1 }} size="B400">
        {name}
      </Text>
    </MenuItem>
  );
}

type UserMentionAutocompleteProps = {
  room: Room;
  editor: Editor;
  query: AutocompleteQuery<string>;
  requestClose: () => void;
};

const withAllowedMembership = (member: RoomMember): boolean =>
  member.membership === Membership.Join ||
  member.membership === Membership.Invite ||
  member.membership === Membership.Knock;

const SEARCH_OPTIONS: UseAsyncSearchOptions = {
  limit: 1000,
  matchOptions: {
    contain: true,
  },
};

const mxIdToName = (mxId: string) => getMxIdLocalPart(mxId) ?? mxId;
const getRoomMemberStr: SearchItemStrGetter<RoomMember> = (m, query) =>
  getMemberSearchStr(m, query, mxIdToName);

export function UserMentionAutocomplete({
  room,
  editor,
  query,
  requestClose,
}: UserMentionAutocompleteProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const roomId: string = room.roomId!;
  const roomAliasOrId = room.getCanonicalAlias() || roomId;
  const members = useRoomMembers(mx, roomId);

  const [result, search, resetSearch] = useAsyncSearch(members, getRoomMemberStr, SEARCH_OPTIONS);
  // The search runs after paint; until it answers the typed text, match here so Tab never takes an unmatched member.
  let matchingMembers = result?.items ?? members;
  let scannedAll = true;
  if (query.text && result?.query !== normalize(query.text, SEARCH_OPTIONS.normalizeOptions)) {
    const found = searchNow(members, query.text, getRoomMemberStr, SEARCH_OPTIONS);
    matchingMembers = found.items;
    scannedAll = found.scannedAll;
  }
  const autoCompleteMembers = matchingMembers.slice(0, 20).filter(withAllowedMembership);

  useEffect(() => {
    if (query.text) search(query.text);
    else resetSearch();
  }, [query.text, search, resetSearch]);

  const handleAutocomplete: MentionAutoCompleteHandler = (uId, name) => {
    const mentionEl = createMentionElement(
      uId,
      name.startsWith('@') ? name : `@${name}`,
      mx.getUserId() === uId || roomAliasOrId === uId
    );
    replaceWithElement(editor, query.range, mentionEl);
    moveCursor(editor, true);
    requestClose();
  };

  useKeyDown(window, (evt: KeyboardEvent) => {
    onTabPress(evt, () => {
      if (query.text === 'room') {
        handleAutocomplete(roomAliasOrId, '@room');
        return;
      }
      if (autoCompleteMembers.length === 0) {
        // A member past the scan may still match; let the search answer rather than guess.
        if (!scannedAll) return;
        const userId = userIdFromQueryText(mx, query.text);
        handleAutocomplete(userId, userId);
        return;
      }
      const roomMember = autoCompleteMembers[0];
      handleAutocomplete(roomMember.userId, roomMember.name);
    });
  });

  const getName = (member: RoomMember) =>
    getMemberDisplayName(room, member.userId) ?? getMxIdLocalPart(member.userId) ?? member.userId;

  return (
    <AutocompleteMenu
      headerContent={<Text size="L400">{t('sharedUi.userMentionAutocomplete.mentions')}</Text>}
      requestClose={requestClose}
    >
      {query.text === 'room' && (
        <UnknownMentionItem
          userId={roomAliasOrId}
          name="@room"
          handleAutocomplete={handleAutocomplete}
        />
      )}
      {autoCompleteMembers.length === 0 ? (
        <UnknownMentionItem
          userId={userIdFromQueryText(mx, query.text)}
          name={userIdFromQueryText(mx, query.text)}
          handleAutocomplete={handleAutocomplete}
        />
      ) : (
        autoCompleteMembers.map((roomMember) => {
          const avatarMxcUrl = roomMember.getMxcAvatarUrl();
          const avatarUrl = avatarMxcUrl
            ? mxcUrlToHttp(mx, avatarMxcUrl, useAuthentication, 32, 32, 'crop')
            : undefined;
          return (
            <MenuItem
              key={roomMember.userId}
              as="button"
              radii="300"
              onKeyDown={(evt: ReactKeyboardEvent<HTMLButtonElement>) =>
                onTabPress(evt, () => handleAutocomplete(roomMember.userId, getName(roomMember)))
              }
              onClick={() => handleAutocomplete(roomMember.userId, getName(roomMember))}
              after={
                <Text size="T200" priority="300" truncate>
                  {roomMember.userId}
                </Text>
              }
              before={
                <Avatar size="200">
                  <UserAvatar
                    userId={roomMember.userId}
                    src={avatarUrl ?? undefined}
                    alt={getName(roomMember)}
                    renderFallback={() => <Icon size="50" src={Icons.User} filled />}
                  />
                </Avatar>
              }
            >
              <Text style={{ flexGrow: 1 }} size="B400" truncate>
                {getName(roomMember)}
              </Text>
            </MenuItem>
          );
        })
      )}
    </AutocompleteMenu>
  );
}
