import { Trans, useTranslation } from 'react-i18next';
import React from 'react';
import { Box, Text, as } from 'folds';
import classNames from 'classnames';
import { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import * as css from './Reaction.css';
import { getHexcodeForEmoji, getShortcodeFor } from '../../plugins/emoji';
import { getMemberDisplayName } from '../../utils/room';
import { eventWithShortcode, getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';

export const Reaction = as<
  'button',
  {
    mx: MatrixClient;
    count: number;
    reaction: string;
    /** Shown instead of the count. */
    label?: string;
    useAuthentication?: boolean;
  }
>(({ className, mx, count, reaction, label, useAuthentication, ...props }, ref) => (
  <Box
    as="button"
    className={classNames(css.Reaction, className)}
    alignItems="Center"
    shrink="No"
    gap="200"
    {...props}
    ref={ref}
  >
    <Text className={css.ReactionText} as="span" size="T400">
      {reaction.startsWith('mxc://') ? (
        <img
          className={css.ReactionImg}
          src={mxcUrlToHttp(mx, reaction, useAuthentication) ?? reaction}
          alt={reaction}
        />
      ) : (
        <Text as="span" size="Inherit" truncate>
          {reaction}
        </Text>
      )}
    </Text>
    <Text as="span" size="T300">
      {label ?? count}
    </Text>
  </Box>
));

type ReactionTooltipMsgProps = {
  room: Room;
  reaction: string;
  events: MatrixEvent[];
};

export function ReactionTooltipMsg({ room, reaction, events }: ReactionTooltipMsgProps) {
  const { t, i18n } = useTranslation();
  const shortCodeEvt = events.find(eventWithShortcode);
  const shortcode =
    shortCodeEvt?.getContent().shortcode ??
    getShortcodeFor(getHexcodeForEmoji(reaction)) ??
    reaction;
  const names = events.map(
    (ev: MatrixEvent) =>
      getMemberDisplayName(room, ev.getSender() ?? 'Unknown') ??
      getMxIdLocalPart(ev.getSender() ?? 'Unknown') ??
      'Unknown'
  );

  const listedNames = names.slice(0, 3);
  if (names.length > 3)
    listedNames.push(t('sharedUi.reaction.others', { count: names.length - 3 }));
  const formattedNames = new Intl.ListFormat(i18n.resolvedLanguage ?? i18n.language, {
    type: 'conjunction',
  }).format(listedNames);
  return (
    <Trans
      t={t}
      shouldUnescape
      tOptions={{ interpolation: { escapeValue: true } }}
      i18nKey="sharedUi.reaction.reactionSummary"
      values={{ names: formattedNames, reaction: shortcode }}
      components={{ names: <b />, reaction: <b /> }}
    />
  );
}
