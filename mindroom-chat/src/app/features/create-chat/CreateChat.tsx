import { Box, Button, color, config, Icon, Icons, Spinner, Switch, Text } from 'folds';
import React, { FormEventHandler, useCallback, useRef, useState } from 'react';
import { ICreateRoomStateEvent, MatrixError, Preset, Visibility } from 'matrix-js-sdk';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SettingTile } from '../../components/setting-tile';
import { SequenceCard } from '../../components/sequence-card';
import { addRoomIdToMDirect, isUserId } from '../../utils/matrix';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { ErrorCode } from '../../cs-errorcode';
import { millisecondsToMinutes } from '../../utils/common';
import { createRoomEncryptionState } from '../../components/create-room';
import { useAlive } from '../../hooks/useAlive';
import { getDirectRoomPath } from '../../pages/pathUtils';
import { useClientConfig } from '../../hooks/useClientConfig';
import { InviteUserAutocomplete } from '../../components/invite-user-prompt';

type CreateChatProps = {
  defaultUserId?: string;
};
export function CreateChat({ defaultUserId }: CreateChatProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const alive = useAlive();
  const navigate = useNavigate();
  const { createRoom: createRoomConfig } = useClientConfig();
  const showEncryptionOption = createRoomConfig?.showEncryptionOption ?? true;
  const defaultEncryption = createRoomConfig?.defaultEncryption ?? true;

  const [encryption, setEncryption] = useState(defaultEncryption);
  const [invalidUserId, setInvalidUserId] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState(defaultUserId ?? '');

  const [createState, create] = useAsyncCallback<string, Error | MatrixError, [string, boolean]>(
    useCallback(
      async (userId, encrypted) => {
        const initialState: ICreateRoomStateEvent[] = [];

        if (encrypted) initialState.push(createRoomEncryptionState());

        const result = await mx.createRoom({
          is_direct: true,
          invite: [userId],
          visibility: Visibility.Private,
          preset: Preset.TrustedPrivateChat,
          initial_state: initialState,
        });

        addRoomIdToMDirect(mx, result.room_id, userId);

        return result.room_id;
      },
      [mx]
    )
  );
  const loading = createState.status === AsyncStatus.Loading;
  const error = createState.status === AsyncStatus.Error ? createState.error : undefined;
  const disabled = createState.status === AsyncStatus.Loading;

  const handleSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    if (disabled) return;
    setInvalidUserId(false);

    const userId = inputValue.trim();

    if (!userId) return;
    if (!isUserId(userId)) {
      setInvalidUserId(true);
      return;
    }

    create(userId, encryption)
      .then((roomId) => {
        if (alive()) {
          setInputValue('');
          navigate(getDirectRoomPath(roomId));
        }
      })
      .catch(() => {
        // useAsyncCallback rethrows after recording the error; the error
        // state is rendered below the form.
      });
  };

  const handleSelect = (userId: string) => {
    setInvalidUserId(false);
    setInputValue(userId);
    inputRef.current?.focus();
  };

  return (
    <Box as="form" onSubmit={handleSubmit} grow="Yes" direction="Column" gap="500">
      <Box direction="Column" gap="100">
        <Text size="L400">{t('featureUi.createChat.userId')}</Text>
        <InviteUserAutocomplete
          ref={inputRef}
          inputValue={inputValue}
          onInputChange={setInputValue}
          onSelect={handleSelect}
          disabled={disabled}
          autoFocus
          variant="SurfaceVariant"
          radii="400"
          menuLabel={t('featureUi.createChat.userSuggestions')}
        />
        {invalidUserId && (
          <Box style={{ color: color.Critical.Main }} alignItems="Center" gap="100">
            <Icon src={Icons.Warning} filled size="50" />
            <Text size="T200" style={{ color: color.Critical.Main }}>
              <b>{t('featureUi.createChat.pleaseEnterAValidUserId')}</b>
            </Text>
          </Box>
        )}
      </Box>
      {showEncryptionOption && (
        <Box shrink="No" direction="Column" gap="100">
          <Text size="L400">{t('featureUi.createChat.options')}</Text>
          <SequenceCard
            style={{ padding: config.space.S300 }}
            variant="SurfaceVariant"
            direction="Column"
            gap="500"
          >
            <SettingTile
              title={t('featureUi.createChat.endToEndEncryption')}
              description={t('featureUi.createChat.onceThisFeatureIsEnabledItCan')}
              after={
                <Switch
                  variant="Primary"
                  value={encryption}
                  onChange={setEncryption}
                  disabled={disabled}
                />
              }
            />
          </SequenceCard>
        </Box>
      )}
      {error && (
        <Box style={{ color: color.Critical.Main }} alignItems="Center" gap="200">
          <Icon src={Icons.Warning} filled size="100" />
          <Text size="T300" style={{ color: color.Critical.Main }}>
            <b>
              {error instanceof MatrixError && error.name === ErrorCode.M_LIMIT_EXCEEDED
                ? t('featureUi.createChat.rateLimited', {
                    count: Number(
                      millisecondsToMinutes((error.data.retry_after_ms as number | undefined) ?? 0)
                    ),
                  })
                : error.message}
            </b>
          </Text>
        </Box>
      )}
      <Box shrink="No" direction="Column" gap="200">
        <Button
          type="submit"
          size="500"
          variant="Primary"
          radii="400"
          disabled={disabled}
          before={loading && <Spinner variant="Primary" fill="Soft" size="200" />}
          outlined
          fill="Soft"
        >
          <Text size="B500">{t('featureUi.createChat.create')}</Text>
        </Button>
      </Box>
    </Box>
  );
}
