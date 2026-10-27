import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { ApprovalResponseContent, createApprovalActions } from './approvalActions';
import { ThreadApprovalRecord } from './threadApprovalModel';

export const useApprovalActions = (
  records: readonly ThreadApprovalRecord[],
  threadId: string,
  now: number,
  send: (content: ApprovalResponseContent) => Promise<unknown>
) => {
  const mx = useMatrixClient();
  const current = useRef(records);
  useLayoutEffect(() => {
    current.current = records;
  }, [records]);
  const controller = useMemo(
    () =>
      createApprovalActions({
        getRecords: () => current.current,
        getUserId: () => mx.getUserId(),
        threadId,
        send,
      }),
    [mx, threadId, send]
  );
  const actions = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => controller.reconcile(), [controller, records, now]);
  return { actions, submit: controller.submit };
};
