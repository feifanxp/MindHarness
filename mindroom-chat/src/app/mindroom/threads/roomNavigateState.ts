export const ROOM_THREAD_EXIT_TARGET_STATE_KEY = '__roomThreadExitTarget';
const ROOM_THREAD_EXIT_TARGET_STORAGE_PREFIX = 'mindroom.roomThreadExitTarget:';

export type RoomThreadExitTarget = {
  roomId: string;
  threadId: string;
  exitPath?: string;
  useHistoryBack?: boolean;
};

const roomThreadExitTargetMemory = new Map<string, RoomThreadExitTarget>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getHistoryEntryKey = (historyState: unknown): string | undefined => {
  if (!isRecord(historyState)) return undefined;
  const key = historyState.key;
  return typeof key === 'string' && key.length > 0 ? key : undefined;
};

const getStoredRoomThreadExitTarget = (entryKey: string): RoomThreadExitTarget | undefined => {
  const memoryTarget = roomThreadExitTargetMemory.get(entryKey);
  if (memoryTarget) return memoryTarget;

  try {
    const storedValue = window.sessionStorage?.getItem(
      `${ROOM_THREAD_EXIT_TARGET_STORAGE_PREFIX}${entryKey}`
    );
    if (!storedValue) return undefined;

    const parsedValue = JSON.parse(storedValue);
    if (!isRecord(parsedValue)) return undefined;
    const roomId = parsedValue.roomId;
    const threadId = parsedValue.threadId;
    if (typeof roomId !== 'string' || typeof threadId !== 'string') return undefined;
    const exitPath = typeof parsedValue.exitPath === 'string' ? parsedValue.exitPath : undefined;
    const useHistoryBack =
      typeof parsedValue.useHistoryBack === 'boolean' ? parsedValue.useHistoryBack : true;

    const target = { roomId, threadId, exitPath, useHistoryBack };
    roomThreadExitTargetMemory.set(entryKey, target);
    return target;
  } catch {
    return undefined;
  }
};

export const setRoomThreadExitTargetForHistoryState = (
  historyState: unknown,
  target: RoomThreadExitTarget
): boolean => {
  const entryKey = getHistoryEntryKey(historyState);
  if (!entryKey) return false;

  roomThreadExitTargetMemory.set(entryKey, target);
  try {
    window.sessionStorage?.setItem(
      `${ROOM_THREAD_EXIT_TARGET_STORAGE_PREFIX}${entryKey}`,
      JSON.stringify(target)
    );
  } catch {
    // Best-effort cache only; in-memory storage still works for the current session.
  }

  return true;
};

export const withRoomThreadExitTargetState = (
  state: unknown,
  target: RoomThreadExitTarget
): Record<string, unknown> => ({
  ...(isRecord(state) ? state : {}),
  [ROOM_THREAD_EXIT_TARGET_STATE_KEY]: target,
});

export const getRoomThreadExitTargetFromHistoryState = (
  historyState: unknown
): RoomThreadExitTarget | undefined => {
  if (isRecord(historyState)) {
    const userState = historyState.usr;
    if (isRecord(userState)) {
      const target = userState[ROOM_THREAD_EXIT_TARGET_STATE_KEY];
      if (isRecord(target)) {
        const roomId = target.roomId;
        const threadId = target.threadId;
        const exitPath = typeof target.exitPath === 'string' ? target.exitPath : undefined;
        const useHistoryBack =
          typeof target.useHistoryBack === 'boolean' ? target.useHistoryBack : true;

        if (typeof roomId === 'string' && typeof threadId === 'string') {
          return { roomId, threadId, exitPath, useHistoryBack };
        }
      }
    }
  }

  const entryKey = getHistoryEntryKey(historyState);
  if (!entryKey) return undefined;
  return getStoredRoomThreadExitTarget(entryKey);
};
