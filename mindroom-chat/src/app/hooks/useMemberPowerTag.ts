import { useTranslation } from 'react-i18next';
import { useCallback, useMemo } from 'react';
import { MatrixClient, Room, RoomMember } from 'matrix-js-sdk';
import { getPowerLevelTag, PowerLevelTags, usePowerLevelTags } from './usePowerLevelTags';
import { IPowerLevels, readPowerLevel } from './usePowerLevels';
import { MemberPowerTag, MemberPowerTagIcon } from '../../types/matrix/room';
import { useRoomCreatorsTag } from './useRoomCreatorsTag';
import { ThemeKind } from './useTheme';
import { accessibleColor } from '../plugins/color';
import { mxcUrlToHttp } from '../utils/mediaUrl';
import { JUMBO_EMOJI_REG } from '../utils/regex';

export type GetMemberPowerTag = (userId: string) => MemberPowerTag;

export const useGetMemberPowerTag = (
  room: Room,
  creators: Set<string>,
  powerLevels: IPowerLevels
) => {
  const { t } = useTranslation();
  const creatorsTag = useRoomCreatorsTag();
  const powerLevelTags = usePowerLevelTags(room, powerLevels);

  const getMemberPowerTag: GetMemberPowerTag = useCallback(
    (userId) => {
      if (creators.has(userId)) {
        return creatorsTag;
      }

      const power = readPowerLevel.user(powerLevels, userId);
      return getPowerLevelTag(powerLevelTags, power, t);
    },
    [creators, creatorsTag, powerLevels, powerLevelTags, t]
  );

  return getMemberPowerTag;
};

export const getPowerTagIconSrc = (
  mx: MatrixClient,
  useAuthentication: boolean,
  icon: MemberPowerTagIcon
): string | undefined => {
  const key = icon?.key;
  if (!key) return undefined;
  if (key.startsWith('mxc://')) {
    return mxcUrlToHttp(mx, key, useAuthentication, 96, 96, 'scale') ?? '🌻';
  }
  // Any other key must be an emoji; never load it as an image URL.
  return JUMBO_EMOJI_REG.test(key) ? key : undefined;
};

export const useAccessiblePowerTagColors = (
  themeKind: ThemeKind,
  creatorsTag: MemberPowerTag,
  powerLevelTags: PowerLevelTags
): Map<string, string> => {
  const accessibleColors: Map<string, string> = useMemo(() => {
    const colors: Map<string, string> = new Map();
    if (creatorsTag.color) {
      colors.set(creatorsTag.color, accessibleColor(themeKind, creatorsTag.color));
    }

    Object.values(powerLevelTags).forEach((tag) => {
      const { color } = tag;
      if (!color) return;

      colors.set(color, accessibleColor(themeKind, color));
    });

    return colors;
  }, [powerLevelTags, creatorsTag, themeKind]);

  return accessibleColors;
};

export const useFlattenPowerTagMembers = (
  members: RoomMember[],
  getTag: GetMemberPowerTag
): Array<MemberPowerTag | RoomMember> => {
  const PLTagOrRoomMember = useMemo(() => {
    let prevTag: MemberPowerTag | undefined;
    const tagOrMember: Array<MemberPowerTag | RoomMember> = [];
    members.forEach((member) => {
      const tag = getTag(member.userId);
      if (tag !== prevTag) {
        prevTag = tag;
        tagOrMember.push(tag);
      }
      tagOrMember.push(member);
    });
    return tagOrMember;
  }, [members, getTag]);

  return PLTagOrRoomMember;
};
