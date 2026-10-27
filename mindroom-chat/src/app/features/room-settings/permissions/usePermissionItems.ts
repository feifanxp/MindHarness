import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageEvent, StateEvent } from '../../../../types/matrix/room';
import { PermissionGroup } from '../../common-settings/permissions';

export const usePermissionGroups = (): PermissionGroup[] => {
  const { t } = useTranslation();
  const groups: PermissionGroup[] = useMemo(() => {
    const messagesGroup: PermissionGroup = {
      name: t('featureUi.roomSettings.permissions.groups.messages'),
      items: [
        {
          location: {
            key: MessageEvent.RoomMessage,
          },
          name: t('featureUi.roomSettings.permissions.sendMessages'),
        },
        {
          location: {
            key: MessageEvent.Sticker,
          },
          name: t('featureUi.roomSettings.permissions.sendStickers'),
        },
        {
          location: {
            key: MessageEvent.Reaction,
          },
          name: t('featureUi.roomSettings.permissions.sendReactions'),
        },
        {
          location: {
            notification: true,
            key: 'room',
          },
          name: t('featureUi.roomSettings.permissions.pingRoom'),
        },
        {
          location: {
            state: true,
            key: StateEvent.RoomPinnedEvents,
          },
          name: t('featureUi.roomSettings.permissions.pinMessages'),
        },
        {
          location: {},
          name: t('featureUi.roomSettings.permissions.otherMessageEvents'),
        },
      ],
    };

    const callSettingsGroup: PermissionGroup = {
      name: t('featureUi.roomSettings.permissions.groups.calls'),
      items: [
        {
          location: {
            state: true,
            key: StateEvent.GroupCallMemberPrefix,
          },
          name: t('featureUi.roomSettings.permissions.startOrJoinCall'),
        },
      ],
    };

    const moderationGroup: PermissionGroup = {
      name: t('featureUi.roomSettings.permissions.groups.moderation'),
      items: [
        {
          location: {
            action: true,
            key: 'invite',
          },
          name: t('featureUi.roomSettings.permissions.invite'),
        },
        {
          location: {
            action: true,
            key: 'kick',
          },
          name: t('featureUi.roomSettings.permissions.kick'),
        },
        {
          location: {
            action: true,
            key: 'ban',
          },
          name: t('featureUi.roomSettings.permissions.ban'),
        },
        {
          location: {
            action: true,
            key: 'redact',
          },
          name: t('featureUi.roomSettings.permissions.deleteOthersMessages'),
        },
        {
          location: {
            key: MessageEvent.RoomRedaction,
          },
          name: t('featureUi.roomSettings.permissions.deleteSelfMessages'),
        },
      ],
    };

    const roomOverviewGroup: PermissionGroup = {
      name: t('featureUi.roomSettings.permissions.groups.roomOverview'),
      items: [
        {
          location: {
            state: true,
            key: StateEvent.RoomAvatar,
          },
          name: t('featureUi.roomSettings.permissions.roomAvatar'),
        },
        {
          location: {
            state: true,
            key: StateEvent.RoomName,
          },
          name: t('featureUi.roomSettings.permissions.roomName'),
        },
        {
          location: {
            state: true,
            key: StateEvent.RoomTopic,
          },
          name: t('featureUi.roomSettings.permissions.roomTopic'),
        },
      ],
    };

    const roomSettingsGroup: PermissionGroup = {
      name: t('featureUi.roomSettings.permissions.groups.settings'),
      items: [
        {
          location: {
            state: true,
            key: StateEvent.RoomJoinRules,
          },
          name: t('featureUi.roomSettings.permissions.changeRoomAccess'),
        },
        {
          location: {
            state: true,
            key: StateEvent.RoomCanonicalAlias,
          },
          name: t('featureUi.roomSettings.permissions.publishAddress'),
        },
        {
          location: {
            state: true,
            key: StateEvent.RoomPowerLevels,
          },
          name: t('featureUi.roomSettings.permissions.changeAllPermission'),
        },
        {
          location: {
            state: true,
            key: StateEvent.PowerLevelTags,
          },
          name: t('featureUi.roomSettings.permissions.editPowerLevels'),
        },
        {
          location: {
            state: true,
            key: StateEvent.RoomEncryption,
          },
          name: t('featureUi.roomSettings.permissions.enableEncryption'),
        },
        {
          location: {
            state: true,
            key: StateEvent.RoomHistoryVisibility,
          },
          name: t('featureUi.roomSettings.permissions.historyVisibility'),
        },
        {
          location: {
            state: true,
            key: StateEvent.RoomTombstone,
          },
          name: t('featureUi.roomSettings.permissions.upgradeRoom'),
        },
        {
          location: {
            state: true,
          },
          name: t('featureUi.roomSettings.permissions.otherSettings'),
        },
      ],
    };

    const otherSettingsGroup: PermissionGroup = {
      name: t('featureUi.roomSettings.permissions.groups.other'),
      items: [
        {
          location: {
            state: true,
            key: StateEvent.PoniesRoomEmotes,
          },
          name: t('featureUi.roomSettings.permissions.manageEmojisStickers'),
        },
        {
          location: {
            state: true,
            key: StateEvent.RoomServerAcl,
          },
          name: t('featureUi.roomSettings.permissions.changeServerAcls'),
        },
        {
          location: {
            state: true,
            key: 'im.vector.modular.widgets',
          },
          name: t('featureUi.roomSettings.permissions.modifyWidgets'),
        },
      ],
    };

    return [
      messagesGroup,
      callSettingsGroup,
      moderationGroup,
      roomOverviewGroup,
      roomSettingsGroup,
      otherSettingsGroup,
    ];
  }, [t]);

  return groups;
};
