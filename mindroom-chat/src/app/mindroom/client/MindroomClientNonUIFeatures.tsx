import { useAtomValue } from 'jotai';
import React, { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { PluginListenerHandle } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import type { MatrixClient } from 'matrix-js-sdk';
import InviteSound from '../../../../public/sound/invite.ogg';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useActiveSession } from '../../hooks/useSessionStore';
import { useClientConfig } from '../../hooks/useClientConfig';
import { getInboxInvitesPath } from '../../pages/pathUtils';
import { allInvitesAtom } from '../../state/room-list/inviteList';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { notificationPermission, setFavicon } from '../../utils/dom';
import { Membership } from '../../../types/matrix/room';
import { MINDROOM_FAVICON_SRC } from '../branding/branding';
import {
  checkIOSPushPermission,
  disableIOSPushPusher,
  isNativeIOSPlatform,
  registerIOSPush,
  resolveIOSPushConfig,
  setIOSPushEnabled,
  unregisterIOSPush,
  upsertIOSPushPusher,
} from '../native/iosPush';
import { useIOSPushEnabled } from '../native/useIOSPushEnabled';
import { useCrossRoomThreadIndex } from '../cross-room-threads/useCrossRoomThreadIndex';
import { useCanvasIndexRecorder } from '../canvas/canvasIndex';
import { useComputerApiUrls } from '../computer/useComputerApiUrl';
import { useModelControllerLifetime } from '../models/useModelPicker';
import { BugReportAutoJoinFeature } from '../bug-reports/BugReportAutoJoinFeature';

const LogoUnreadSVG = MINDROOM_FAVICON_SRC;
const LogoHighlightSVG = MINDROOM_FAVICON_SRC;

function MindroomFaviconUpdater() {
  const roomToUnread = useAtomValue(roomToUnreadAtom);

  useEffect(() => {
    let notification = false;
    let highlight = false;
    roomToUnread.forEach((unread) => {
      if (unread.total > 0) {
        notification = true;
      }
      if (unread.highlight > 0) {
        highlight = true;
      }
    });

    if (notification) {
      setFavicon(highlight ? LogoHighlightSVG : LogoUnreadSVG);
    } else {
      setFavicon(MINDROOM_FAVICON_SRC);
    }
  }, [roomToUnread]);

  return null;
}

function CrossRoomThreadIndexFeature() {
  useCrossRoomThreadIndex();
  return null;
}

// Canvases and computers are separate opt-ins, and the recorder serves both: it lists canvases and
// notes where an agent showed its computer, which the header's Computer button needs.
export function CanvasIndexFeature() {
  const canvasesEnabled = useClientConfig().mindroom?.canvas?.enabled === true;
  const computersAvailable = useComputerApiUrls().urls.length > 0;
  useCanvasIndexRecorder(useMatrixClient(), canvasesEnabled || computersAvailable);
  return null;
}

const createKnownInviteRoomIdSet = (mx: MatrixClient): Set<string> => {
  const roomIds = new Set<string>();
  mx.getRooms().forEach((room) => {
    if (room.getMyMembership() === Membership.Invite) {
      roomIds.add(room.roomId);
    }
  });
  return roomIds;
};

type InviteObservationState = {
  mx: MatrixClient;
  knownRoomIds: Set<string>;
  currentRoomIds: Set<string>;
  suppressedRoomIds: Set<string>;
  lastInvites: string[];
};

export function MindroomInviteNotifications() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const invites = useAtomValue(allInvitesAtom);
  const mx = useMatrixClient();
  const inviteObservationStateRef = useRef<InviteObservationState>();
  if (!inviteObservationStateRef.current || inviteObservationStateRef.current.mx !== mx) {
    const knownRoomIds = createKnownInviteRoomIdSet(mx);
    inviteObservationStateRef.current = {
      mx,
      knownRoomIds,
      currentRoomIds: new Set(invites),
      suppressedRoomIds: new Set(invites.filter((roomId) => !knownRoomIds.has(roomId))),
      lastInvites: invites,
    };
  }

  const navigate = useNavigate();
  const [showNotifications] = useSetting(settingsAtom, 'showNotifications');
  const [notificationSound] = useSetting(settingsAtom, 'isNotificationSounds');

  const notify = useCallback(
    (count: number) => {
      const noti = new window.Notification('Invitation', {
        icon: MINDROOM_FAVICON_SRC,
        badge: MINDROOM_FAVICON_SRC,
        body: `You have ${count} new invitation request.`,
        silent: true,
      });

      noti.onclick = () => {
        if (!window.closed) navigate(getInboxInvitesPath());
        noti.close();
      };
    },
    [navigate]
  );

  const playSound = useCallback(() => {
    const audioElement = audioRef.current;
    void audioElement?.play().catch(() => undefined);
  }, []);

  useEffect(() => {
    const observationState = inviteObservationStateRef.current;
    if (!observationState) return;

    const currentRoomIds = new Set(invites);
    const inviteAtomEmitted = observationState.lastInvites !== invites;
    const enteredInviteRoomIds = invites.filter(
      (roomId) =>
        !observationState.knownRoomIds.has(roomId) && !observationState.currentRoomIds.has(roomId)
    );
    const reemittedSuppressedRoomId =
      enteredInviteRoomIds.length === 0 && inviteAtomEmitted
        ? [...invites]
            .reverse()
            .find(
              (roomId) =>
                !observationState.knownRoomIds.has(roomId) &&
                observationState.currentRoomIds.has(roomId) &&
                observationState.suppressedRoomIds.has(roomId)
            )
        : undefined;
    const newInviteRoomIds = reemittedSuppressedRoomId
      ? [reemittedSuppressedRoomId]
      : enteredInviteRoomIds;

    observationState.currentRoomIds.forEach((roomId) => {
      if (!currentRoomIds.has(roomId)) {
        observationState.knownRoomIds.delete(roomId);
        observationState.suppressedRoomIds.delete(roomId);
      }
    });
    newInviteRoomIds.forEach((roomId) => {
      observationState.knownRoomIds.add(roomId);
      observationState.suppressedRoomIds.delete(roomId);
    });
    observationState.currentRoomIds = currentRoomIds;
    observationState.lastInvites = invites;

    if (newInviteRoomIds.length > 0 && mx.getSyncState() === 'SYNCING') {
      if (showNotifications && notificationPermission('granted')) {
        notify(newInviteRoomIds.length);
      }

      if (notificationSound) {
        playSound();
      }
    }
  }, [mx, invites, showNotifications, notificationSound, notify, playSound]);

  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <audio ref={audioRef} preload="none" style={{ display: 'none' }}>
      <source src={InviteSound} type="audio/ogg" />
    </audio>
  );
}

function MindroomNativeIOSPushFeature() {
  const mx = useMatrixClient();
  const language = useAppLanguageCode();
  const clientConfig = useClientConfig();
  const activeSession = useActiveSession();
  const sessionId = activeSession?.sessionId;
  const nativePushNotifications = useIOSPushEnabled(sessionId);

  useEffect(() => {
    const pushConfig = resolveIOSPushConfig(clientConfig, sessionId, language);
    if (!isNativeIOSPlatform() || !pushConfig) return undefined;

    let disposed = false;
    let registrationHandle: PluginListenerHandle | undefined;
    let registrationErrorHandle: PluginListenerHandle | undefined;

    const setupNativePush = async () => {
      const registrationListener = await PushNotifications.addListener('registration', (token) => {
        if (disposed) return;
        upsertIOSPushPusher(mx, pushConfig, token.value, sessionId).catch(async () => {
          setIOSPushEnabled(false, sessionId);
          await disableIOSPushPusher(mx, pushConfig, sessionId).catch(() => undefined);
          await unregisterIOSPush().catch(() => undefined);
        });
      });
      if (disposed) {
        registrationListener.remove().catch(() => undefined);
        return;
      }
      registrationHandle = registrationListener;

      const registrationErrorListener = await PushNotifications.addListener(
        'registrationError',
        () => {
          setIOSPushEnabled(false, sessionId);
          disableIOSPushPusher(mx, pushConfig, sessionId).catch(() => undefined);
          unregisterIOSPush().catch(() => undefined);
        }
      );
      if (disposed) {
        registrationErrorListener.remove().catch(() => undefined);
        return;
      }
      registrationErrorHandle = registrationErrorListener;

      if (!nativePushNotifications) {
        await disableIOSPushPusher(mx, pushConfig, sessionId);
        await unregisterIOSPush().catch(() => undefined);
        return;
      }

      const permission = await checkIOSPushPermission();
      if (permission !== 'granted') {
        setIOSPushEnabled(false, sessionId);
        await disableIOSPushPusher(mx, pushConfig, sessionId);
        await unregisterIOSPush().catch(() => undefined);
        return;
      }

      await registerIOSPush();
    };

    setupNativePush().catch(async () => {
      setIOSPushEnabled(false, sessionId);
      await disableIOSPushPusher(mx, pushConfig, sessionId).catch(() => undefined);
      await unregisterIOSPush().catch(() => undefined);
    });

    return () => {
      disposed = true;
      registrationHandle?.remove().catch(() => undefined);
      registrationErrorHandle?.remove().catch(() => undefined);
    };
  }, [clientConfig, language, mx, nativePushNotifications, sessionId]);

  return null;
}

export function MindroomClientNonUIFeatures() {
  useModelControllerLifetime();
  return (
    <>
      <CrossRoomThreadIndexFeature />
      <CanvasIndexFeature />
      <MindroomFaviconUpdater />
      <MindroomInviteNotifications />
      <MindroomNativeIOSPushFeature />
      <BugReportAutoJoinFeature />
    </>
  );
}
