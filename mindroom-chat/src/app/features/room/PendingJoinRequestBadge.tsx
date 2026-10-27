import React from 'react';
import { Badge, Text, toRem } from 'folds';
import type { TFunction } from 'i18next';

export const getPendingJoinRequestLabel = (
  t: TFunction,
  baseLabel: string,
  count: number
): string =>
  count > 0
    ? t('featureUi.room.pendingJoinRequests.accessibleLabel', { baseLabel, count })
    : baseLabel;

type PendingJoinRequestBadgeProps = {
  count: number;
};

export function PendingJoinRequestBadge({ count }: PendingJoinRequestBadgeProps) {
  if (count <= 0) return null;

  return (
    <Badge
      style={{
        position: 'absolute',
        left: toRem(3),
        top: toRem(3),
      }}
      variant="Primary"
      size="400"
      fill="Solid"
      radii="Pill"
    >
      <Text as="span" size="L400">
        {count}
      </Text>
    </Badge>
  );
}
