import React from 'react';
import { Icon, IconButton, Icons, Text, Tooltip, TooltipProvider } from 'folds';

export function ComputerHeaderButton({
  label,
  available,
  open,
  onToggle,
}: {
  label: string;
  available: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  if (!available) return null;

  return (
    <TooltipProvider
      position="Bottom"
      offset={4}
      tooltip={
        <Tooltip>
          <Text>{label}</Text>
        </Tooltip>
      }
    >
      {(triggerRef) => (
        <IconButton
          fill="None"
          ref={triggerRef}
          onClick={onToggle}
          aria-label={label}
          aria-pressed={open}
        >
          <Icon size="400" src={Icons.Monitor} filled={open} />
        </IconButton>
      )}
    </TooltipProvider>
  );
}
