import { useTranslation } from 'react-i18next';
import React, { useCallback, useEffect } from 'react';
import FocusTrap from 'focus-trap-react';
import {
  Overlay,
  OverlayCenter,
  OverlayBackdrop,
  config,
  Box,
  Text,
  IconButton,
  Icon,
  Icons,
  color,
  Button,
  Spinner,
} from 'folds';
import { MatrixError } from 'matrix-js-sdk';
import { Dialog, Header } from '../glass/GlassPrimitives';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { stopPropagation } from '../../utils/keyboard';

type LeaveSpacePromptProps = {
  roomId: string;
  onDone: () => void;
  onCancel: () => void;
};
export function LeaveSpacePrompt({ roomId, onDone, onCancel }: LeaveSpacePromptProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();

  const [leaveState, leaveRoom] = useAsyncCallback<undefined, MatrixError, []>(
    useCallback(async () => {
      mx.leave(roomId);
    }, [mx, roomId])
  );

  const handleLeave = () => {
    leaveRoom();
  };

  useEffect(() => {
    if (leaveState.status === AsyncStatus.Success) {
      onDone();
    }
  }, [leaveState, onDone]);

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            onDeactivate: onCancel,
            clickOutsideDeactivates: true,
            escapeDeactivates: stopPropagation,
          }}
        >
          <Dialog variant="Surface">
            <Header
              style={{
                padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
                borderBottomWidth: config.borderWidth.B300,
              }}
              variant="Surface"
              size="500"
            >
              <Box grow="Yes">
                <Text size="H4">{t('sharedUi.leaveSpacePrompt.leaveSpace')}</Text>
              </Box>
              <IconButton size="300" onClick={onCancel} radii="300">
                <Icon src={Icons.Cross} />
              </IconButton>
            </Header>
            <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
              <Box direction="Column" gap="200">
                <Text priority="400">
                  {t('sharedUi.leaveSpacePrompt.areYouSureYouWantToLeaveThisSpace')}
                </Text>
                {leaveState.status === AsyncStatus.Error && (
                  <Text style={{ color: color.Critical.Main }} size="T300">
                    {t('sharedUi.leaveSpacePrompt.leaveFailed', {
                      error: leaveState.error.message,
                    })}
                  </Text>
                )}
              </Box>
              <Button
                type="submit"
                variant="Critical"
                onClick={handleLeave}
                before={
                  leaveState.status === AsyncStatus.Loading ? (
                    <Spinner fill="Soft" variant="Critical" size="200" />
                  ) : undefined
                }
                aria-disabled={
                  leaveState.status === AsyncStatus.Loading ||
                  leaveState.status === AsyncStatus.Success
                }
                outlined
                radii="300"
                fill="Soft"
              >
                <Text size="B400">
                  {leaveState.status === AsyncStatus.Loading
                    ? t('sharedUi.leaveSpacePrompt.leaving')
                    : t('sharedUi.leaveSpacePrompt.leave')}
                </Text>
              </Button>
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
