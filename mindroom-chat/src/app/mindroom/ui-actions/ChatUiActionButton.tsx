import React, { useContext } from 'react';
import { type MatrixEvent } from 'matrix-js-sdk';
import { Box, Button, Icon, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { ChatUiActionContext } from './ChatUiActionProvider';

/** This affordance is deliberately passive: only an explicit click invokes the action. */
export function ChatUiActionButton({ event }: { event: MatrixEvent }) {
  const actions = useContext(ChatUiActionContext);
  const { t } = useTranslation();
  const action = actions?.read(event);
  if (!action || !actions) return null;
  const unavailable = actions.unavailable(action);
  const [icon, label] =
    action.action === 'show_computer'
      ? [Icons.Monitor, t('mindroomUi.uiActions.viewComputer', { defaultValue: 'View computer' })]
      : action.action === 'open_settings'
      ? [Icons.Setting, t('commandPalette.actions.openSettings', { defaultValue: 'Open Settings' })]
      : action.action === 'show_canvas'
      ? [Icons.Category, t('mindroomUi.uiActions.openCanvas', { defaultValue: 'Open canvas' })]
      : [Icons.User, t('mindroomUi.uiActions.openMembers', { defaultValue: 'Open Members' })];

  return (
    <Box direction="Column" alignItems="Start" gap="100">
      <Button
        size="300"
        variant="Primary"
        fill="Soft"
        outlined
        radii="300"
        disabled={!!unavailable}
        onClick={() => actions.activate(event)}
        before={<Icon size="100" src={icon} />}
      >
        <Text size="B300">{label}</Text>
      </Button>
      {unavailable && <Text size="T200">{unavailable}</Text>}
    </Box>
  );
}
