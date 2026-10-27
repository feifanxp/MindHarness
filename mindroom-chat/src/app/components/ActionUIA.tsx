import React, { ReactNode } from 'react';
import { AuthDict, AuthType, IAuthData, UIAFlow } from 'matrix-js-sdk';
import { getUIAFlowForStages } from '../utils/matrix-uia';
import { useSupportedUIAFlows, useUIACompleted, useUIAFlow } from '../hooks/useUIAFlows';
import { UIAFlowOverlay } from './UIAFlowOverlay';
import { PasswordStage, SSOStage } from './uia-stages';
import { useMatrixClient } from '../hooks/useMatrixClient';

export const SUPPORTED_IN_APP_UIA_STAGES = [AuthType.Password, AuthType.Sso];

export const pickUIAFlow = (uiaFlows: UIAFlow[]): UIAFlow | undefined => {
  const ssoFlow = getUIAFlowForStages(uiaFlows, [AuthType.Sso]);
  if (ssoFlow) return ssoFlow;

  const passwordFlow = getUIAFlowForStages(uiaFlows, [AuthType.Password]);
  if (passwordFlow) return passwordFlow;

  // Keep a deterministic fallback for any remaining supported multi-stage flow.
  return uiaFlows[0];
};

type ActionUIAProps = {
  authData: IAuthData;
  ongoingFlow: UIAFlow;
  action: (authDict: AuthDict) => void;
  onCancel: () => void;
};
export function ActionUIA({ authData, ongoingFlow, action, onCancel }: ActionUIAProps) {
  const mx = useMatrixClient();
  const completed = useUIACompleted(authData);
  const { getStageToComplete } = useUIAFlow(authData, ongoingFlow);

  const stageToComplete = getStageToComplete();

  if (!stageToComplete) return null;
  return (
    <UIAFlowOverlay
      currentStep={completed.length + 1}
      stepCount={ongoingFlow.stages.length}
      onCancel={onCancel}
    >
      {stageToComplete.type === AuthType.Password && (
        <PasswordStage
          userId={mx.getUserId()!}
          stageData={stageToComplete}
          onCancel={onCancel}
          submitAuthDict={action}
        />
      )}
      {stageToComplete.type === AuthType.Sso && stageToComplete.session && (
        <SSOStage
          ssoRedirectURL={mx.getFallbackAuthUrl(AuthType.Sso, stageToComplete.session)}
          stageData={stageToComplete}
          onCancel={onCancel}
          submitAuthDict={action}
        />
      )}
    </UIAFlowOverlay>
  );
}

type ActionUIAFlowsLoaderProps = {
  authData: IAuthData;
  unsupported: () => ReactNode;
  children: (ongoingFlow: UIAFlow) => ReactNode;
};
export function ActionUIAFlowsLoader({
  authData,
  unsupported,
  children,
}: ActionUIAFlowsLoaderProps) {
  const supportedFlows = useSupportedUIAFlows(authData.flows ?? [], SUPPORTED_IN_APP_UIA_STAGES);
  const ongoingFlow = pickUIAFlow(supportedFlows);

  if (!ongoingFlow) return unsupported();

  return children(ongoingFlow);
}
