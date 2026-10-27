import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { atom, useAtomValue, useStore } from 'jotai';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useClientConfig } from '../../hooks/useClientConfig';
import { useCallEmbed, useCallStart } from '../../hooks/useCallEmbed';
import { useLivekitSupport } from '../../hooks/useLivekitSupport';
import { callEmbedAtom } from '../../state/callEmbed';
import { webRTCSupported } from '../../utils/rtc';
import { waitForJoinedRoom } from '../matrix/waitForJoinedRoom';
import { requestMicrophoneAccess } from '../voice/microphoneAccess';
import {
  clearAgentCallOrigin,
  createAgentVoiceRoom,
  findAgentCallRoom,
  MindroomAgentCallOrigin,
  prepareAgentCallRoom,
} from './agentCall';

type AgentCallTarget = { userId: string; displayName?: string };

type StartAgentCall = {
  startAgentCall: (agent: AgentCallTarget, origin: MindroomAgentCallOrigin) => Promise<boolean>;
  /** False when the homeserver or browser cannot place calls at all. */
  supported: boolean;
  loading: boolean;
  error?: string;
  unavailableReason?: string;
};

// Shared by every entry point, so a second start cannot begin while one is being set up.
const agentCallStartingAtom = atom(false);

/**
 * Starts the embedded call in the caller's permanent call room with a MindRoom agent, creating it on first use.
 * Resolves `true` once the call has started and never navigates; callers decide what to show next.
 */
export function useStartAgentCall(): StartAgentCall {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const { createRoom } = useClientConfig();
  const startCall = useCallStart(false);
  const callEmbed = useCallEmbed();
  const livekitSupported = useLivekitSupport();
  const rtcSupported = webRTCSupported();
  const store = useStore();
  const loading = useAtomValue(agentCallStartingAtom);
  const [error, setError] = useState<string>();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const unavailableReason = !livekitSupported
    ? t('mindroomUi.calls.agentCallButton.homeserverUnsupported')
    : !rtcSupported
    ? t('mindroomUi.calls.agentCallButton.browserUnsupported')
    : callEmbed
    ? t('mindroomUi.calls.agentCallButton.endCurrentCall')
    : undefined;

  const startAgentCall = async (
    agent: AgentCallTarget,
    origin: MindroomAgentCallOrigin
  ): Promise<boolean> => {
    if (store.get(agentCallStartingAtom) || unavailableReason) return false;
    store.set(agentCallStartingAtom, true);
    setError(undefined);
    let unusedOriginRoomId: string | undefined;

    try {
      await requestMicrophoneAccess();
      if (!mountedRef.current) return false;

      let room = findAgentCallRoom(mx, agent.userId);
      if (!room) {
        const encrypted = createRoom?.defaultEncryption ?? true;
        const roomId = await createAgentVoiceRoom(mx, agent.userId, agent.displayName, encrypted);
        room = await waitForJoinedRoom(mx, roomId);
      }
      await prepareAgentCallRoom(mx, room, agent.userId, origin);
      unusedOriginRoomId = room.roomId;
      // A call answered meanwhile must not be replaced by this one; the room stays for the next call.
      if (!mountedRef.current || store.get(callEmbedAtom)) return false;
      startCall(room, { microphone: true, video: false, sound: true });
      unusedOriginRoomId = undefined;
      return true;
    } catch (callError) {
      if (!mountedRef.current) return false;
      setError(callError instanceof Error ? callError.message : 'Failed to start the call.');
      return false;
    } finally {
      store.set(agentCallStartingAtom, false);
      if (unusedOriginRoomId) clearAgentCallOrigin(mx, unusedOriginRoomId, agent.userId);
    }
  };

  const supported = livekitSupported && rtcSupported;
  return { startAgentCall, supported, loading, error, unavailableReason };
}
