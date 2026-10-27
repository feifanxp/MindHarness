import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { getModelController, ModelPickerSnapshot } from './modelController';

export type ModelPickerState = ModelPickerSnapshot & {
  refresh: () => void;
  chooseRuntime: (runtimeId: string) => void;
  selectModel: (modelKey: string) => void;
  resetToRoomDefault: () => void;
};

/** Mount once with the client; picker dismissal must never dispose this owner. */
export const useModelControllerLifetime = (): void => {
  const mx = useMatrixClient();
  const controller = useMemo(() => getModelController(mx), [mx]);
  useEffect(() => controller.retain(), [controller]);
};

/** Subscription and actions only: protocol and pending state live in the client owner. */
export const useModelPicker = (room: Room, threadId: string | undefined): ModelPickerState => {
  const mx = useMatrixClient();
  const controller = useMemo(() => getModelController(mx), [mx]);
  const subscribe = useCallback(
    (listener: () => void) => controller.subscribe(room, threadId, listener),
    [controller, room, threadId]
  );
  const getSnapshot = useCallback(
    () => controller.getSnapshot(room, threadId),
    [controller, room, threadId]
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const actions = useMemo(
    () => ({
      refresh: () => controller.refresh(room, threadId),
      chooseRuntime: (runtimeId: string) => controller.chooseRuntime(room, threadId, runtimeId),
      selectModel: (key: string) => controller.selectModel(room, threadId, key),
      resetToRoomDefault: () => controller.resetToRoomDefault(room, threadId),
    }),
    [controller, room, threadId]
  );
  return useMemo(() => ({ ...snapshot, ...actions }), [snapshot, actions]);
};
