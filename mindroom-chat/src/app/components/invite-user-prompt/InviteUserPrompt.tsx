import { useTranslation } from 'react-i18next';
import React, { FormEventHandler, useCallback, useMemo, useRef, useState } from 'react';
import {
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Box,
  config,
  Text,
  IconButton,
  Icon,
  Icons,
  Button,
  Spinner,
  color,
  TextArea,
  toRem,
} from 'folds';
import { Room } from 'matrix-js-sdk';
import FocusTrap from 'focus-trap-react';
import { Dialog, Header } from '../glass/GlassPrimitives';
import { stopPropagation } from '../../utils/keyboard';
import { isUserId } from '../../utils/matrix';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { BreakWord } from '../../styles/Text.css';
import { useAlive } from '../../hooks/useAlive';
import { InviteUserAutocomplete } from './InviteUserAutocomplete';

type InviteUserProps = {
  room: Room;
  requestClose: () => void;
};
export function InviteUserPrompt({ room, requestClose }: InviteUserProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const alive = useAlive();

  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState('');
  const validUserId = useMemo(
    () => (isUserId(inputValue.trim()) ? inputValue.trim() : undefined),
    [inputValue]
  );

  const [inviteState, invite] = useAsyncCallback<void, Error, [string, string | undefined]>(
    useCallback(
      async (userId, reason) => {
        await mx.invite(room.roomId, userId, reason);
      },
      [mx, room]
    )
  );

  const inviting = inviteState.status === AsyncStatus.Loading;

  const handleReset = () => {
    setInputValue('');
  };

  const handleSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    const target = evt.target as HTMLFormElement | undefined;

    if (inviting || !validUserId) return;

    const reasonInput = target?.reasonInput as HTMLTextAreaElement | undefined;
    const reason = reasonInput?.value.trim();

    invite(validUserId, reason || undefined).then(() => {
      if (alive()) {
        handleReset();
        if (reasonInput) reasonInput.value = '';
      }
    });
  };

  const handleUserId = (userId: string) => {
    setInputValue(userId);
    inputRef.current?.focus();
  };

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            initialFocus: () => inputRef.current,
            clickOutsideDeactivates: true,
            onDeactivate: requestClose,
            escapeDeactivates: stopPropagation,
          }}
        >
          <Dialog
            style={{
              width: '100%',
              maxWidth: `min(calc(100vw - 2 * ${config.space.S400}), ${toRem(680)})`,
            }}
          >
            <Box grow="Yes" direction="Column">
              <Header
                size="500"
                style={{ padding: `0 ${config.space.S200} 0 ${config.space.S400}` }}
              >
                <Box grow="Yes">
                  <Text size="H4" truncate>
                    {t('sharedUi.inviteUserPrompt.invite')}
                  </Text>
                </Box>
                <Box shrink="No">
                  <IconButton size="300" radii="300" onClick={requestClose}>
                    <Icon src={Icons.Cross} />
                  </IconButton>
                </Box>
              </Header>
              <Box
                as="form"
                onSubmit={handleSubmit}
                shrink="No"
                style={{ padding: config.space.S400 }}
                direction="Column"
                gap="400"
              >
                <Box direction="Column" gap="100">
                  <Text size="L400">{t('sharedUi.inviteUserPrompt.userId')}</Text>
                  <InviteUserAutocomplete
                    ref={inputRef}
                    room={room}
                    inputValue={inputValue}
                    onInputChange={setInputValue}
                    onSelect={handleUserId}
                    disabled={inviting}
                  />
                </Box>
                <Box direction="Column" gap="100">
                  <Text size="L400">{t('sharedUi.inviteUserPrompt.reasonOptional')}</Text>
                  <TextArea
                    size="500"
                    name="reasonInput"
                    variant="Background"
                    rows={4}
                    resize="None"
                  />
                </Box>
                {inviteState.status === AsyncStatus.Error && (
                  <Text size="T200" style={{ color: color.Critical.Main }} className={BreakWord}>
                    <b>{inviteState.error.message}</b>
                  </Text>
                )}
                <Button
                  type="submit"
                  disabled={!validUserId || inviting}
                  before={inviting && <Spinner size="200" variant="Primary" fill="Soft" />}
                  outlined
                  radii="300"
                  fill="Soft"
                >
                  <Text size="B400">{t('sharedUi.inviteUserPrompt.invite')}</Text>
                </Button>
              </Box>
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
