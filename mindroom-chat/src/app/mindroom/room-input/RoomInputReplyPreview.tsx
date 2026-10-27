import React from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, IconButton, Icons, Text } from 'folds';
import { Room } from 'matrix-js-sdk';

import { ReplyLayout } from '../../components/message';
import { useAccessiblePowerTagColors, useGetMemberPowerTag } from '../../hooks/useMemberPowerTag';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { useIsDirectRoom } from '../../hooks/useRoom';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomCreatorsTag } from '../../hooks/useRoomCreatorsTag';
import { usePowerLevelTags } from '../../hooks/usePowerLevelTags';
import { useTheme } from '../../hooks/useTheme';
import { useSetting } from '../../state/hooks/settings';
import { IReplyDraft } from '../../state/room/roomInputDrafts';
import { settingsAtom } from '../../state/settings';
import { getMemberDisplayName } from '../../utils/room';
import { getMxIdLocalPart } from '../../utils/matrix';
import colorMXID from '../../../util/colorMXID';
import {
  getReplyPreviewText,
  replaceMatrixUserIdsWithDisplayNames,
} from '../threads/threadMessagePreview';
import { MindroomRoomInputReplyContext } from './RoomInputMindroomExtensions';

type RoomInputReplyPreviewProps = {
  room: Room;
  replyDraft: IReplyDraft | undefined;
  threadId?: string;
  submitPending: boolean;
  onCancel: () => void;
};

export function RoomInputReplyPreview({
  room,
  replyDraft,
  threadId,
  submitPending,
  onCancel,
}: RoomInputReplyPreviewProps) {
  const { t } = useTranslation();
  // Not memoized: room members load lazily, and the body analysis is cached.
  // A canvas title skips the Markdown preview but names members as the sent quote does.
  const preview = replyDraft?.previewText
    ? replaceMatrixUserIdsWithDisplayNames(room, replyDraft.previewText, '@')
    : getReplyPreviewText(room, { body: replyDraft?.body }, t);
  const [legacyUsernameColor] = useSetting(settingsAtom, 'legacyUsernameColor');
  const direct = useIsDirectRoom();
  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);
  const powerLevelTags = usePowerLevelTags(room, powerLevels);
  const creatorsTag = useRoomCreatorsTag();
  const getMemberPowerTag = useGetMemberPowerTag(room, creators, powerLevels);
  const theme = useTheme();
  const accessibleTagColors = useAccessiblePowerTagColors(theme.kind, creatorsTag, powerLevelTags);

  const replyUserId = replyDraft?.userId;
  const replyPowerTag = replyUserId ? getMemberPowerTag(replyUserId) : undefined;
  const replyPowerColor = replyPowerTag?.color
    ? accessibleTagColors.get(replyPowerTag.color)
    : undefined;
  const replyUsernameColor =
    legacyUsernameColor || direct ? colorMXID(replyUserId ?? '') : replyPowerColor;

  if (!replyDraft && (!threadId || !submitPending)) return null;

  return (
    <MindroomRoomInputReplyContext
      room={room}
      relation={replyDraft?.relation}
      pendingSend={!!threadId && submitPending}
      leading={
        replyDraft && (
          <IconButton onClick={onCancel} variant="SurfaceVariant" size="300" radii="300">
            <Icon src={Icons.Cross} size="50" />
          </IconButton>
        )
      }
    >
      {replyDraft && (
        <ReplyLayout
          userColor={replyUsernameColor}
          username={
            <Text size="T300" truncate>
              <b>
                {getMemberDisplayName(room, replyDraft.userId) ??
                  getMxIdLocalPart(replyDraft.userId) ??
                  replyDraft.userId}
              </b>
            </Text>
          }
        >
          <Text size="T300" truncate>
            {preview}
          </Text>
        </ReplyLayout>
      )}
    </MindroomRoomInputReplyContext>
  );
}
