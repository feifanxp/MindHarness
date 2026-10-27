import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Icons, Text, as } from 'folds';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { MenuItem } from '../../components/glass/GlassPrimitives';
import * as css from '../../features/room/message/styles.css';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { saveFile } from '../native/nativeFileSave';
import { useBugReportAdmins } from './bugReportConfig';
import { buildBugReport, getBugReportFileName, serializeBugReport } from './bugReportPayload';
import { ensureBugReportRoom } from './bugReportRoom';
import { sendBugReport } from './sendBugReport';

type SendState = 'idle' | 'sending' | 'error';

export const MessageBugReportItem = as<
  'button',
  {
    room: Room;
    mEvent: MatrixEvent;
    onClose?: () => void;
  }
>(({ room, mEvent, onClose, ...props }, ref) => {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const admins = useBugReportAdmins();
  const { navigateRoomThread } = useRoomNavigate();
  const [state, setState] = useState<SendState>('idle');

  const handleClick = async () => {
    setState('sending');
    let sent: { roomId: string; threadRootId: string } | undefined;
    try {
      const report = await buildBugReport(mx, room, mEvent);
      if (admins.length === 0) {
        await saveFile(serializeBugReport(report), getBugReportFileName(report));
        setState('idle');
      } else {
        const reportRoom = await ensureBugReportRoom(mx, admins);
        sent = await sendBugReport(mx, reportRoom, report);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[bug-report] could not send the report', error);
      setState('error');
      return;
    }
    // Outside the try: a failure after a successful send must not offer a duplicate report.
    onClose?.();
    if (sent) navigateRoomThread(sent.roomId, sent.threadRootId);
  };

  let label =
    admins.length > 0
      ? t('mindroomUi.messages.bugReport.report')
      : t('mindroomUi.messages.bugReport.download');
  if (state === 'sending') label = t('mindroomUi.messages.bugReport.sending');
  if (state === 'error') label = t('mindroomUi.messages.bugReport.failed');

  return (
    <MenuItem
      size="300"
      after={<Icon size="100" src={Icons.Flag} />}
      radii="300"
      onClick={handleClick}
      disabled={state === 'sending'}
      {...props}
      ref={ref}
    >
      <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
        {label}
      </Text>
    </MenuItem>
  );
});
