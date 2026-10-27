import React, { useMemo, useState } from 'react';
import type { Room } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import {
  Badge,
  Icon,
  IconButton,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Text,
  Tooltip,
  TooltipProvider,
} from 'folds';
import { useScheduledTaskEvents } from '../threads/useScheduledTaskEvents';
import { getPendingRoomSchedules } from './roomSchedules';
import { RoomSchedulesDialog } from './RoomSchedulesDialog';
import { stopPropagation } from '../../utils/keyboard';
import * as css from './roomSchedules.css';

export function RoomSchedulesButton({
  room,
  onOpenThread,
}: {
  room: Room;
  onOpenThread: (threadId: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const events = useScheduledTaskEvents(room);
  const tasks = useMemo(() => getPendingRoomSchedules(events), [events]);
  const label = t('roomSchedules.openLabel', { total: tasks.length });

  return (
    <>
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
            ref={triggerRef}
            className={css.Trigger}
            fill="None"
            aria-label={label}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <Icon size="400" src={Icons.Clock} />
            {tasks.length > 0 && (
              <Badge
                className={css.Count}
                variant="Secondary"
                size="400"
                fill="Solid"
                radii="Pill"
                aria-hidden="true"
              >
                <Text as="span" size="L400">
                  {tasks.length}
                </Text>
              </Badge>
            )}
          </IconButton>
        )}
      </TooltipProvider>
      {open && (
        <Overlay open backdrop={<OverlayBackdrop />}>
          <OverlayCenter>
            <FocusTrap
              focusTrapOptions={{
                onDeactivate: () => setOpen(false),
                clickOutsideDeactivates: true,
                escapeDeactivates: stopPropagation,
              }}
            >
              <RoomSchedulesDialog
                roomId={room.roomId}
                tasks={tasks}
                onClose={() => setOpen(false)}
                onOpenThread={(threadId) => {
                  setOpen(false);
                  onOpenThread(threadId);
                }}
              />
            </FocusTrap>
          </OverlayCenter>
        </Overlay>
      )}
    </>
  );
}
