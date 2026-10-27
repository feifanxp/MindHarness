import { useMatrixClient } from '../../hooks/useMatrixClient';
import { getMxIdLocalPart } from '../../utils/matrix';
import { useThreadApprovals } from './ThreadApprovalProvider';

type ApprovalMember = { userId: string; name?: string; getMxcAvatarUrl?: () => string | undefined };

export type ApprovalMemberRoom = {
  getMember: (userId: string) => { name?: string } | null;
  getJoinedMembers: () => ApprovalMember[];
};

/** The room an approval belongs to, for resolving people and agents to display names. */
export const useApprovalRoom = (roomId?: string): ApprovalMemberRoom | null | undefined => {
  const mx = useMatrixClient();
  const context = useThreadApprovals();
  const id = roomId ?? context?.roomId;
  return id ? (mx.getRoom?.(id) as ApprovalMemberRoom | null | undefined) : undefined;
};

// MindRoom names agent accounts mindroom_<agent>, or mindroom_<agent>_<namespace> where the
// namespace is 4-32 lowercase letters and digits. Prefix matching would mistake
// mindroom_assistant_pro for the account of `assistant`.
const NAMESPACE = '[a-z0-9]{4,32}';

export const agentMember = (
  room: ApprovalMemberRoom | null | undefined,
  agentName: string
): ApprovalMember | undefined => {
  const base = `mindroom_${agentName.toLowerCase()}`;
  const namespaced = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_${NAMESPACE}$`);
  const members = room?.getJoinedMembers() ?? [];
  const localpart = (userId: string) => (getMxIdLocalPart(userId) ?? '').toLowerCase();
  return (
    members.find((item) => localpart(item.userId) === base) ??
    members.find((item) => namespaced.test(localpart(item.userId)))
  );
};

export const agentDisplayName = (
  room: ApprovalMemberRoom | null | undefined,
  agentName: string
): string => agentMember(room, agentName)?.name || agentName;

export const userDisplayName = (
  room: ApprovalMemberRoom | null | undefined,
  userId: string
): string => room?.getMember(userId)?.name || getMxIdLocalPart(userId) || userId;
