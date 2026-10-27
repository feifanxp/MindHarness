import React, { type ReactNode, type RefCallback } from 'react';
import { Box, Text, Tooltip, TooltipProvider, type Align, type Position } from 'folds';

export type IconTooltipProps = {
  label: string;
  /** A second, quieter line, e.g. what pressing the button does. */
  hint?: string;
  position?: Position;
  align?: Align;
  children: (triggerRef: RefCallback<HTMLElement | SVGElement>) => ReactNode;
};

// An icon-only button names itself in a tooltip, as the room header's buttons
// do. Give the button the same label as its aria-label.
export function IconTooltip({
  label,
  hint,
  position = 'Bottom',
  align,
  children,
}: IconTooltipProps) {
  return (
    <TooltipProvider
      position={position}
      align={align}
      offset={4}
      tooltip={
        <Tooltip>
          <Box direction="Column">
            <Text size="T300">{label}</Text>
            {hint && (
              <Text size="T200" priority="300">
                {hint}
              </Text>
            )}
          </Box>
        </Tooltip>
      }
    >
      {children}
    </TooltipProvider>
  );
}
