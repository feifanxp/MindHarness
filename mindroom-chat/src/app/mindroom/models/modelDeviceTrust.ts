import { MatrixClient, Room } from 'matrix-js-sdk';
import { isMindroomAgentUserIdForViewer } from '../matrix/agentIdentity';
import { deviceSignedByOwner } from '../../utils/matrix-crypto';

export type ModelRuntime = { id: string; userId: string; deviceId: string; curveKey: string };
export const joinedModelCandidates = (mx: MatrixClient, room: Room): string[] => {
  const viewer = mx.getUserId();
  if (!viewer || room.getMember(viewer)?.membership !== 'join') return [];
  return room
    .getJoinedMembers()
    .filter((m) => m.userId !== viewer && isMindroomAgentUserIdForViewer(m.userId, viewer))
    .map((m) => m.userId);
};
export const hasJoinedModelAgent = (
  mx: MatrixClient,
  room: Room,
  runtime: ModelRuntime,
  agents: string[]
): boolean => {
  const candidates = joinedModelCandidates(mx, room);
  return (
    candidates.includes(runtime.userId) &&
    agents.some((id) => id !== runtime.userId && candidates.includes(id))
  );
};
export const signedModelDevices = async (
  mx: MatrixClient,
  users: string[]
): Promise<ModelRuntime[]> => {
  const crypto = mx.getCrypto();
  if (!crypto || users.length === 0 || users.length > 64) return [];
  const deviceMap = await crypto.getUserDeviceInfo(users, true);
  const devices: ModelRuntime[] = [];
  for (const userId of users) {
    for (const [deviceId, device] of deviceMap.get(userId) ?? []) {
      const curveKey = device.getIdentityKey();
      if (
        !curveKey ||
        !deviceId ||
        deviceId.length > 255 ||
        !(await deviceSignedByOwner(crypto, userId, deviceId))
      )
        continue;
      devices.push({
        id: JSON.stringify([userId, deviceId, curveKey]),
        userId,
        deviceId,
        curveKey,
      });
      if (devices.length > 256) return [];
    }
  }
  return devices;
};
export const isCurrentModelRuntime = async (
  mx: MatrixClient,
  runtime: ModelRuntime
): Promise<boolean> => {
  const devices = await signedModelDevices(mx, [runtime.userId]);
  return devices.some((device) => device.id === runtime.id);
};
