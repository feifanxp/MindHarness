import { Room } from 'matrix-js-sdk';
import React from 'react';
import { Box, Icon, Icons, Text } from 'folds';
import { Trans, useTranslation } from 'react-i18next';
import { getMemberDisplayName } from '../../utils/room';
import { getMxIdLocalPart } from '../../utils/matrix';

type MemberSpeakingProps = {
  room: Room;
  speakers: Set<string>;
};
export function MemberSpeaking({ room, speakers }: MemberSpeakingProps) {
  const { t } = useTranslation();
  const speakingNames = Array.from(speakers).map(
    (userId) => getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId
  );
  return (
    <Box alignItems="Center" gap="100">
      <Icon size="100" src={Icons.Mic} filled />
      <Text size="T200" truncate>
        {speakingNames.length === 1 && (
          <Trans
            i18nKey="featureUi.callStatus.memberSpeaking.one"
            t={t}
            shouldUnescape
            tOptions={{ interpolation: { escapeValue: true } }}
            values={{ name: speakingNames[0] }}
            components={{ name: <b /> }}
          />
        )}
        {speakingNames.length === 2 && (
          <Trans
            i18nKey="featureUi.callStatus.memberSpeaking.two"
            t={t}
            shouldUnescape
            tOptions={{ interpolation: { escapeValue: true } }}
            values={{ first: speakingNames[0], second: speakingNames[1] }}
            components={{ first: <b />, second: <b /> }}
          />
        )}
        {speakingNames.length === 3 && (
          <Trans
            i18nKey="featureUi.callStatus.memberSpeaking.three"
            t={t}
            shouldUnescape
            tOptions={{ interpolation: { escapeValue: true } }}
            values={{ first: speakingNames[0], second: speakingNames[1], third: speakingNames[2] }}
            components={{ first: <b />, second: <b />, third: <b /> }}
          />
        )}
        {speakingNames.length > 3 && (
          <Trans
            i18nKey={
              speakingNames.length === 4
                ? 'featureUi.callStatus.memberSpeaking.four'
                : 'featureUi.callStatus.memberSpeaking.many'
            }
            t={t}
            shouldUnescape
            tOptions={{ interpolation: { escapeValue: true } }}
            values={{
              first: speakingNames[0],
              second: speakingNames[1],
              third: speakingNames[2],
              count: speakingNames.length - 3,
            }}
            components={{ first: <b />, second: <b />, third: <b />, others: <b /> }}
          />
        )}
      </Text>
    </Box>
  );
}
