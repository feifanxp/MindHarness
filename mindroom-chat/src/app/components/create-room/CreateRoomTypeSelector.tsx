import { useTranslation } from 'react-i18next';
import React from 'react';
import { Box, Text, Icon, Icons, config, IconSrc } from 'folds';
import { SequenceCard } from '../sequence-card';
import { SettingTile } from '../setting-tile';
import { CreateRoomType } from './types';
import { BetaNoticeBadge } from '../BetaNoticeBadge';

type CreateRoomTypeSelectorProps = {
  value?: CreateRoomType;
  onSelect: (value: CreateRoomType) => void;
  disabled?: boolean;
  getIcon: (type: CreateRoomType) => IconSrc;
};
export function CreateRoomTypeSelector({
  value,
  onSelect,
  disabled,
  getIcon,
}: CreateRoomTypeSelectorProps) {
  const { t } = useTranslation();
  return (
    <Box shrink="No" direction="Column" gap="100">
      <SequenceCard
        style={{ padding: config.space.S300 }}
        variant={value === CreateRoomType.TextRoom ? 'Primary' : 'SurfaceVariant'}
        direction="Column"
        gap="100"
        as="button"
        type="button"
        aria-pressed={value === CreateRoomType.TextRoom}
        onClick={() => onSelect(CreateRoomType.TextRoom)}
        disabled={disabled}
      >
        <SettingTile
          before={<Icon size="400" src={getIcon(CreateRoomType.TextRoom)} />}
          after={value === CreateRoomType.TextRoom && <Icon src={Icons.Check} />}
        >
          <Box gap="200" alignItems="Baseline">
            <Text size="H6" style={{ flexShrink: 0 }}>
              {t('sharedUi.createRoomTypeSelector.chatRoom')}
            </Text>
            <Text size="T300" priority="300" truncate>
              {t('sharedUi.createRoomTypeSelector.messagesPhotosAndVideos')}
            </Text>
          </Box>
        </SettingTile>
      </SequenceCard>
      <SequenceCard
        style={{ padding: config.space.S300 }}
        variant={value === CreateRoomType.VoiceRoom ? 'Primary' : 'SurfaceVariant'}
        direction="Column"
        gap="100"
        as="button"
        type="button"
        aria-pressed={value === CreateRoomType.VoiceRoom}
        onClick={() => onSelect(CreateRoomType.VoiceRoom)}
        disabled={disabled}
      >
        <SettingTile
          before={<Icon size="400" src={getIcon(CreateRoomType.VoiceRoom)} />}
          after={value === CreateRoomType.VoiceRoom && <Icon src={Icons.Check} />}
        >
          <Box gap="200" alignItems="Baseline">
            <Text size="H6" style={{ flexShrink: 0 }}>
              {t('sharedUi.createRoomTypeSelector.voiceRoom')}
            </Text>
            <Text size="T300" priority="300" truncate>
              {t('sharedUi.createRoomTypeSelector.liveAudioAndVideoConversations')}
            </Text>
            <BetaNoticeBadge />
          </Box>
        </SettingTile>
      </SequenceCard>
    </Box>
  );
}
