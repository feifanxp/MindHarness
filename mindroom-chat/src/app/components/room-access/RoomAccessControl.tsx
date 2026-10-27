import { useTranslation } from 'react-i18next';
import React, {
  FormEventHandler,
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  EventType,
  JoinRule,
  MatrixError,
  Room,
  RoomEvent,
  RoomStateEvent,
  type MatrixEvent,
  type RoomState,
} from 'matrix-js-sdk';
import {
  Box,
  Button,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
  TextArea,
  color,
  config,
} from 'folds';
import FocusTrap from 'focus-trap-react';
import { Dialog } from '../glass/GlassPrimitives';

import { Membership } from '../../../types/matrix/room';
import { AsyncState, AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useAlive } from '../../hooks/useAlive';
import { useMatrixClient } from '../../hooks/useMatrixClient';

export type RoomAccessJoinRule = JoinRule | 'knock_restricted';
export type RoomAccessKind = 'join' | 'knock';
type RoomAccessResult = Room | { room_id: string };

export const isRoomAccessJoinRule = (joinRule: unknown): joinRule is RoomAccessJoinRule =>
  joinRule === JoinRule.Public ||
  joinRule === JoinRule.Restricted ||
  joinRule === JoinRule.Knock ||
  joinRule === 'knock_restricted' ||
  joinRule === JoinRule.Invite;

export const getDiscoveredRoomAccessJoinRule = (
  joinRule: unknown
): RoomAccessJoinRule | undefined =>
  joinRule === undefined ? JoinRule.Public : isRoomAccessJoinRule(joinRule) ? joinRule : undefined;

export const isActionableRoomAccessJoinRule = (
  joinRule: unknown,
  membership?: string
): joinRule is RoomAccessJoinRule =>
  isRoomAccessJoinRule(joinRule) &&
  (joinRule !== JoinRule.Invite || membership === Membership.Invite);

export type RoomAccessView = {
  kind: RoomAccessKind;
  state: AsyncState<RoomAccessResult, MatrixError>;
  loading: boolean;
  requested: boolean;
  succeeded: boolean;
  activate: () => void;
};

type RoomAccessControlProps = {
  roomIdOrAlias: string;
  roomId?: string;
  roomName: string;
  joinRule?: RoomAccessJoinRule;
  membership?: string;
  viaServers?: string[];
  fallback?: ReactNode;
  children: (view: RoomAccessView) => ReactNode;
};

type RoomAccessSessionProps = Omit<RoomAccessControlProps, 'roomId' | 'roomIdOrAlias'> & {
  accessRoomId: string;
  kind: RoomAccessKind;
};

function RoomAccessSession({
  roomName,
  joinRule,
  membership,
  viaServers,
  fallback,
  children,
  accessRoomId,
  kind,
}: RoomAccessSessionProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const alive = useAlive();
  const dialogRef = useRef<HTMLDivElement>(null);
  const reasonInputRef = useRef<HTMLTextAreaElement>(null);
  const dialogTitleId = useId();
  const reasonInputId = useId();
  const [roomMembership, setRoomMembership] = useState(
    () => (mx.getRoom(accessRoomId)?.getMyMembership() ?? membership) as Membership | undefined
  );
  const canJoinWithKnockMembership =
    roomMembership === Membership.Knock &&
    (joinRule === JoinRule.Public || joinRule === JoinRule.Restricted);
  const accessKind: RoomAccessKind =
    roomMembership === Membership.Invite || canJoinWithKnockMembership
      ? 'join'
      : roomMembership === Membership.Knock
      ? 'knock'
      : kind;
  const sessionJoinRule =
    roomMembership === Membership.Ban
      ? undefined
      : roomMembership === Membership.Invite
      ? JoinRule.Invite
      : roomMembership === Membership.Knock && !canJoinWithKnockMembership
      ? JoinRule.Knock
      : joinRule;
  const attemptKindRef = useRef<RoomAccessKind>();
  const invitationJoinAttemptRef = useRef(false);
  const loadingRef = useRef(false);
  const invalidateAttemptForMembership = useCallback((nextMembership?: Membership) => {
    const joinAttemptSuperseded =
      attemptKindRef.current === 'join' &&
      (nextMembership === Membership.Join ||
        nextMembership === Membership.Leave ||
        (invitationJoinAttemptRef.current && nextMembership !== Membership.Invite));
    if (nextMembership === Membership.Ban || joinAttemptSuperseded) {
      attemptKindRef.current = undefined;
      invitationJoinAttemptRef.current = false;
    }
  }, []);

  const [accessState, access] = useAsyncCallback<
    RoomAccessResult,
    MatrixError,
    [string | undefined]
  >(
    useCallback(
      (reason) =>
        accessKind === 'knock'
          ? mx.knockRoom(accessRoomId, { reason, viaServers })
          : mx.joinRoom(accessRoomId, { viaServers }),
      [accessKind, accessRoomId, mx, viaServers]
    )
  );
  const [requestInvalidated, setRequestInvalidated] = useState(false);
  useEffect(() => {
    const nextMembership = (mx.getRoom(accessRoomId)?.getMyMembership() ?? membership) as
      | Membership
      | undefined;
    invalidateAttemptForMembership(nextMembership);
    if (kind === 'knock' && nextMembership !== undefined) {
      if (attemptKindRef.current === 'knock') attemptKindRef.current = undefined;
      setRequestInvalidated(nextMembership !== Membership.Knock);
    }
    setRoomMembership(nextMembership);
  }, [accessRoomId, invalidateAttemptForMembership, kind, membership, mx]);

  useEffect(() => {
    setRequestInvalidated(false);
    const updateMembership = (nextMembership: string) => {
      invalidateAttemptForMembership(nextMembership as Membership);
      setRoomMembership(nextMembership as Membership);
      if (kind === 'knock') {
        if (attemptKindRef.current === 'knock') attemptKindRef.current = undefined;
        setRequestInvalidated(nextMembership !== Membership.Knock);
      }
    };
    const handleMembership = (room: Room, nextMembership: string) => {
      if (room.roomId === accessRoomId) updateMembership(nextMembership);
    };
    const handleStateEvent = (event: MatrixEvent, state: RoomState) => {
      if (
        state.roomId !== accessRoomId ||
        event.getType() !== EventType.RoomMember ||
        event.getStateKey() !== mx.getUserId()
      ) {
        return;
      }

      const nextMembership = event.getContent().membership;
      if (typeof nextMembership === 'string') updateMembership(nextMembership);
    };

    mx.on(RoomEvent.MyMembership, handleMembership);
    mx.on(RoomStateEvent.Events, handleStateEvent);
    return () => {
      mx.removeListener(RoomEvent.MyMembership, handleMembership);
      mx.removeListener(RoomStateEvent.Events, handleStateEvent);
    };
  }, [accessRoomId, invalidateAttemptForMembership, kind, mx]);

  const state: AsyncState<RoomAccessResult, MatrixError> =
    accessState.status === AsyncStatus.Idle || attemptKindRef.current === accessKind
      ? accessState
      : { status: AsyncStatus.Idle };
  const loading = state.status === AsyncStatus.Loading;
  useLayoutEffect(() => {
    loadingRef.current = loading;
  }, [loading]);
  const succeeded =
    state.status === AsyncStatus.Success && !(accessKind === 'knock' && requestInvalidated);
  const requested = accessKind === 'knock' && (succeeded || roomMembership === Membership.Knock);
  const [viewKnock, setViewKnock] = useState(false);
  const closeKnock = () => setViewKnock(false);
  useEffect(() => {
    if (roomMembership !== undefined && roomMembership !== Membership.Leave) setViewKnock(false);
  }, [roomMembership]);
  const activate = () => {
    if (loading || requested || succeeded) return;

    if (accessKind === 'knock') {
      setViewKnock(true);
      return;
    }

    attemptKindRef.current = accessKind;
    invitationJoinAttemptRef.current = roomMembership === Membership.Invite;
    access(undefined).catch(() => undefined);
  };
  const handleKnockSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    if (loading || requested) return;

    const target = evt.target as HTMLFormElement | undefined;
    const reasonInput = target?.reasonInput as HTMLTextAreaElement | undefined;
    const reason = reasonInput?.value.trim() || undefined;

    setRequestInvalidated(false);
    const attemptKind = accessKind;
    attemptKindRef.current = attemptKind;
    invitationJoinAttemptRef.current = false;
    access(reason)
      .then(() => {
        if (alive() && attemptKindRef.current === attemptKind) {
          closeKnock();
        }
      })
      .catch(() => undefined);
  };

  if (roomMembership === Membership.Join) return null;
  if (!isActionableRoomAccessJoinRule(sessionJoinRule, roomMembership)) return fallback ?? null;

  return (
    <>
      {children({ kind: accessKind, state, loading, requested, succeeded, activate })}
      {accessKind === 'knock' && (
        <Overlay open={viewKnock} backdrop={<OverlayBackdrop />}>
          <OverlayCenter>
            <FocusTrap
              focusTrapOptions={{
                initialFocus: () => reasonInputRef.current ?? dialogRef.current ?? document.body,
                clickOutsideDeactivates: () => !loadingRef.current,
                onDeactivate: closeKnock,
                escapeDeactivates: (event) => {
                  if (loadingRef.current) return false;
                  event.stopPropagation();
                  return true;
                },
                fallbackFocus: () => dialogRef.current ?? document.body,
              }}
            >
              <Dialog
                ref={dialogRef}
                variant="Surface"
                role="dialog"
                aria-modal="true"
                aria-labelledby={dialogTitleId}
                tabIndex={-1}
              >
                <Box
                  as="form"
                  onSubmit={handleKnockSubmit}
                  style={{ padding: config.space.S400 }}
                  direction="Column"
                  gap="400"
                >
                  <Box direction="Column" gap="100">
                    <Text as="h2" id={dialogTitleId} size="H4">
                      {t('sharedUi.roomAccessControl.requestToJoinValue1', { value1: roomName })}
                    </Text>
                    <Text size="T300" priority="400">
                      {t('sharedUi.roomAccessControl.anAdminWillReviewYourRequest')}
                    </Text>
                  </Box>
                  <Box direction="Column" gap="100">
                    <Text as="label" htmlFor={reasonInputId} size="L400">
                      {t('sharedUi.roomAccessControl.messageOptional')}
                    </Text>
                    <TextArea
                      ref={reasonInputRef}
                      id={reasonInputId}
                      name="reasonInput"
                      variant="Background"
                      size="500"
                      rows={3}
                      resize="None"
                      disabled={loading}
                    />
                  </Box>
                  {state.status === AsyncStatus.Error && (
                    <Text role="alert" size="T200" style={{ color: color.Critical.Main }}>
                      {state.error.message || t('sharedUi.roomAccessControl.failedToSendRequest')}
                    </Text>
                  )}
                  <Box gap="200" justifyContent="End">
                    <Button
                      type="button"
                      variant="Secondary"
                      fill="Soft"
                      onClick={closeKnock}
                      disabled={loading}
                      outlined
                      radii="300"
                    >
                      <Text size="B400">{t('sharedUi.roomAccessControl.cancel')}</Text>
                    </Button>
                    <Button
                      type="submit"
                      disabled={loading}
                      before={loading && <Spinner size="200" variant="Primary" fill="Soft" />}
                      outlined
                      radii="300"
                      fill="Soft"
                    >
                      <Text size="B400">
                        {loading
                          ? t('sharedUi.roomAccessControl.sendingRequest')
                          : t('sharedUi.roomAccessControl.sendRequest')}
                      </Text>
                    </Button>
                  </Box>
                </Box>
              </Dialog>
            </FocusTrap>
          </OverlayCenter>
        </Overlay>
      )}
    </>
  );
}

export function RoomAccessControl({
  roomIdOrAlias,
  roomId,
  joinRule,
  membership,
  fallback,
  ...props
}: RoomAccessControlProps) {
  const mx = useMatrixClient();
  const knownRoom = mx.getRoom(roomId ?? roomIdOrAlias);
  const accessRoomId = roomId ?? knownRoom?.roomId ?? roomIdOrAlias;
  const accessMembership = knownRoom?.getMyMembership() ?? membership;
  const kind: RoomAccessKind =
    joinRule === JoinRule.Knock || joinRule === 'knock_restricted' ? 'knock' : 'join';

  return (
    <RoomAccessSession
      key={`${kind}:${accessRoomId}`}
      {...props}
      joinRule={joinRule}
      membership={accessMembership}
      fallback={fallback}
      accessRoomId={accessRoomId}
      kind={kind}
    />
  );
}
