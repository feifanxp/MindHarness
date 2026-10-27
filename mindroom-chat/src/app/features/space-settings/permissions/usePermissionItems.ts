import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StateEvent } from '../../../../types/matrix/room';
import { PermissionGroup } from '../../common-settings/permissions';

export const usePermissionGroups = (): PermissionGroup[] => {
  const { t } = useTranslation();
  const groups: PermissionGroup[] = useMemo(() => {
    const messagesGroup: PermissionGroup = {
      name: t('featureUi.spaceSettings.permissions.groups.manage'),
      items: [
        {
          location: {
            state: true,
            key: StateEvent.SpaceChild,
          },
          name: t('featureUi.spaceSettings.permissions.manageSpaceRooms'),
        },
        {
          location: {},
          name: t('featureUi.spaceSettings.permissions.messageEvents'),
        },
      ],
    };

    const moderationGroup: PermissionGroup = {
      name: t('featureUi.spaceSettings.permissions.groups.moderation'),
      items: [
        {
          location: {
            action: true,
            key: 'invite',
          },
          name: t('featureUi.spaceSettings.permissions.invite'),
        },
        {
          location: {
            action: true,
            key: 'kick',
          },
          name: t('featureUi.spaceSettings.permissions.kick'),
        },
        {
          location: {
            action: true,
            key: 'ban',
          },
          name: t('featureUi.spaceSettings.permissions.ban'),
        },
      ],
    };

    const roomOverviewGroup: PermissionGroup = {
      name: t('featureUi.spaceSettings.permissions.groups.spaceOverview'),
      items: [
        {
          location: {
            state: true,
            key: StateEvent.RoomAvatar,
          },
          name: t('featureUi.spaceSettings.permissions.spaceAvatar'),
        },
        {
          location: {
            state: true,
            key: StateEvent.RoomName,
          },
          name: t('featureUi.spaceSettings.permissions.spaceName'),
        },
        {
          location: {
            state: true,
            key: StateEvent.RoomTopic,
          },
          name: t('featureUi.spaceSettings.permissions.spaceTopic'),
        },
      ],
    };

    const roomSettingsGroup: PermissionGroup = {
      name: t('featureUi.spaceSettings.permissions.groups.settings'),
      items: [
        {
          location: {
            state: true,
            key: StateEvent.RoomJoinRules,
          },
          name: t('featureUi.spaceSettings.permissions.changeSpaceAccess'),
        },
        {
          location: {
            state: true,
            key: StateEvent.RoomCanonicalAlias,
          },
          name: t('featureUi.spaceSettings.permissions.publishAddress'),
        },
        {
          location: {
            state: true,
            key: StateEvent.RoomPowerLevels,
          },
          name: t('featureUi.spaceSettings.permissions.changeAllPermission'),
        },
        {
          location: {
            state: true,
            key: StateEvent.PowerLevelTags,
          },
          name: t('featureUi.spaceSettings.permissions.editPowerLevels'),
        },
        {
          location: {
            state: true,
            key: StateEvent.RoomTombstone,
          },
          name: t('featureUi.spaceSettings.permissions.upgradeSpace'),
        },
        {
          location: {
            state: true,
          },
          name: t('featureUi.spaceSettings.permissions.otherSettings'),
        },
      ],
    };

    const otherSettingsGroup: PermissionGroup = {
      name: t('featureUi.spaceSettings.permissions.groups.other'),
      items: [
        {
          location: {
            state: true,
            key: StateEvent.PoniesRoomEmotes,
          },
          name: t('featureUi.spaceSettings.permissions.manageEmojisStickers'),
        },
        {
          location: {
            state: true,
            key: StateEvent.RoomServerAcl,
          },
          name: t('featureUi.spaceSettings.permissions.changeServerAcls'),
        },
      ],
    };

    return [
      messagesGroup,
      moderationGroup,
      roomOverviewGroup,
      roomSettingsGroup,
      otherSettingsGroup,
    ];
  }, [t]);

  return groups;
};
