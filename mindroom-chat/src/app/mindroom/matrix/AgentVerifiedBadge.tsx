import { useTranslation } from 'react-i18next';
import React from 'react';
import { Box, Icon, Icons, Text, Tooltip, TooltipProvider, color } from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { isMindroomAgentUserIdForViewer } from './agentIdentity';
import { useAgentDeviceCrossSigned } from './useAgentDeviceTrust';

type ShieldSize = '50' | '100' | '200' | '300' | '400';

type AgentVerifiedBadgeProps = {
  userId: string;
  size?: ShieldSize;
};

function AgentVerifiedShield({ size }: { size: ShieldSize }) {
  const { t } = useTranslation();
  return (
    <TooltipProvider
      position="Top"
      tooltip={
        <Tooltip>
          <Text size="T200">
            {t('mindroomUi.matrix.agentVerifiedBadge.verifiedAgentCrossSignedDevice')}
          </Text>
        </Tooltip>
      }
    >
      {(triggerRef) => (
        <Box
          as="span"
          ref={triggerRef}
          shrink="No"
          alignItems="Center"
          role="img"
          aria-label={t('mindroomUi.matrix.agentVerifiedBadge.verifiedAgent')}
        >
          <Icon size={size} src={Icons.ShieldUser} style={{ color: color.Success.Main }} />
        </Box>
      )}
    </TooltipProvider>
  );
}

function AgentVerifiedBadgeInner({ userId, size }: { userId: string; size: ShieldSize }) {
  const crossSigned = useAgentDeviceCrossSigned(userId);
  if (!crossSigned) return null;

  return <AgentVerifiedShield size={size} />;
}

/**
 * A small shield shown next to a MindRoom agent whose device identity is
 * cross-signed. The badge is restricted to agents on the viewer's own
 * homeserver — `signedByOwner` is self-attestation, so without a same-server
 * check any account registered as `@mindroom_*:anyserver.org` could bootstrap
 * cross-signing and earn the shield in shared rooms. Non-agents and
 * cross-homeserver users short-circuit before any crypto hook runs (so member
 * rows for humans do no crypto work and register no device-list listeners);
 * agents that have not bootstrapped cross-signing, or clients without crypto,
 * render nothing, keeping the baseline visually quiet.
 */
export function AgentVerifiedBadge({ userId, size = '50' }: AgentVerifiedBadgeProps) {
  const mx = useMatrixClient();
  if (!isMindroomAgentUserIdForViewer(userId, mx.getUserId() ?? undefined)) return null;

  return <AgentVerifiedBadgeInner userId={userId} size={size} />;
}
