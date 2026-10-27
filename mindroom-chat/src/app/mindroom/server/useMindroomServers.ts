import {
  RoomEvent,
  RoomStateEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type RoomMember,
  type RoomState,
} from 'matrix-js-sdk';
import { Capacitor } from '@capacitor/core';
import { useEffect, useMemo, useState } from 'react';
import { useForceUpdate } from '../../hooks/useForceUpdate';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { agentRoomState, useAgentRoomStateVersion } from '../matrix/agentRoomState';
import { readOpenIdBinding } from '../matrix/openidAudience';
import { isMindroomAgentUserIdForViewer } from '../matrix/agentIdentity';
import {
  MINDROOM_SERVER_EVENT,
  distinctServerUrls,
  isLoopbackOrigin,
  selectMindroomServers,
  type MindroomServer,
} from './mindroomServer';

// In the native apps a published localhost server is the phone itself, never the agent's MindRoom.
const roomServers = (room: Room): MindroomServer[] =>
  selectMindroomServers(agentRoomState(room, MINDROOM_SERVER_EVENT)).filter(
    (server) => !(Capacitor.isNativePlatform() && isLoopbackOrigin(server.apiUrl))
  );

// One answer per client for what Chat shows; a token for a published origin is only ever requested after a
// new check. A check that could not reach the homeserver is not kept, so the next mount asks again.
const bindingChecks = new WeakMap<MatrixClient, Promise<boolean | undefined>>();

/** Whether the homeserver binds OpenID tokens, asked once per client, so Chat may offer the origins agents publish. */
export const useBindsOpenIdTokens = (): boolean => {
  const mx = useMatrixClient();
  const [binds, setBinds] = useState(false);
  useEffect(() => {
    let current = true;
    let check = bindingChecks.get(mx);
    if (!check) {
      check = readOpenIdBinding(mx);
      bindingChecks.set(mx, check);
    }
    check.then((value) => {
      if (value === undefined) bindingChecks.delete(mx);
      if (current) setBinds(value === true);
    });
    return () => {
      current = false;
    };
  }, [mx]);
  return binds;
};

/** The servers of the room's agents, read again when one changes or an agent's membership does. */
export const useRoomMindroomServers = (room: Room): MindroomServer[] => {
  const version = useAgentRoomStateVersion(room, MINDROOM_SERVER_EVENT);
  return useMemo(() => {
    void version;
    return roomServers(room);
  }, [room, version]);
};

/** Every server the agents in the user's rooms publish, newest first, while the homeserver binds tokens. */
export const useMindroomServerUrls = (): string[] => {
  const mx = useMatrixClient();
  const bindsTokens = useBindsOpenIdTokens();
  const [version, refresh] = useForceUpdate();
  useEffect(() => {
    const viewer = mx.getUserId() ?? undefined;
    const onState = (event: MatrixEvent) => {
      if (event.getType() === MINDROOM_SERVER_EVENT) refresh();
    };
    // Only an agent's membership, or the user's own, changes which servers count.
    const onMember = (_event: MatrixEvent, _state: RoomState, member: RoomMember) => {
      if (isMindroomAgentUserIdForViewer(member.userId, viewer)) refresh();
    };
    mx.on(RoomStateEvent.Events, onState);
    mx.on(RoomStateEvent.Members, onMember);
    mx.on(RoomEvent.MyMembership, refresh);
    return () => {
      mx.removeListener(RoomStateEvent.Events, onState);
      mx.removeListener(RoomStateEvent.Members, onMember);
      mx.removeListener(RoomEvent.MyMembership, refresh);
    };
  }, [mx, refresh]);
  return useMemo(() => {
    void version;
    if (!bindsTokens) return [];
    return distinctServerUrls(
      mx
        .getRooms()
        .filter((room) => room.getMyMembership() === 'join')
        .flatMap(roomServers)
    );
  }, [mx, bindsTokens, version]);
};
