import { MsgType, type MatrixClient, type Room } from 'matrix-js-sdk';
import type { RoomMessageEventContent } from 'matrix-js-sdk/lib/@types/events';
import { getFileMsgContent } from '../../features/room/msgContent';
import { getMatrixToRoomEvent } from '../../plugins/matrix-to';
import type { TUploadItem } from '../../state/room/roomInputDrafts';
import { encryptFile } from '../../utils/matrix';
import { getMessageRelation } from '../threads/composeMessageRelation';
import {
  BUG_REPORT_TYPE,
  BUG_REPORT_VERSION,
  getBugReportFileName,
  serializeBugReport,
  type BugReport,
} from './bugReportPayload';
import { getReporterName } from './bugReportRoom';

/** English on purpose: Matrix content is read by administrators and agents, not localized. */
export const buildBugReportSummary = (report: BugReport, reporterName: string): string => {
  const { target, reporter, client } = report;
  const lines = [
    `Bug report from ${reporterName} (${reporter.userId})`,
    `Message: ${target.permalink}`,
  ];
  if (target.threadId) {
    lines.push(`Thread: ${getMatrixToRoomEvent(target.roomId, target.threadId)}`);
  }
  lines.push(
    `Room: ${target.roomName}`,
    `Client: MindRoom Chat ${client.build} (${client.platform})`,
    'The debug data is attached below. Add any details in this thread.'
  );
  return lines.join('\n');
};

const uploadReportFile = async (mx: MatrixClient, reportRoom: Room, report: BugReport) => {
  const fileName = getBugReportFileName(report);
  const plain = new File([serializeBugReport(report)], fileName, { type: 'application/json' });
  const metadata = { markedAsSpoiler: false };
  const item: TUploadItem = reportRoom.hasEncryptionStateEvent()
    ? { ...(await encryptFile(plain)), metadata }
    : { file: plain, originalFile: plain, encInfo: undefined, metadata };
  const { content_uri: mxc } = await mx.uploadContent(item.file, {
    name: fileName,
    type: item.encInfo ? 'application/octet-stream' : 'application/json',
    includeFilename: !item.encInfo,
  });
  if (!mxc) throw new Error('The bug report upload returned no content URI.');
  return getFileMsgContent(item, mxc);
};

export const sendBugReport = async (
  mx: MatrixClient,
  reportRoom: Room,
  report: BugReport
): Promise<{ roomId: string; threadRootId: string }> => {
  // Upload first: a failed upload must not leave a summary without its attachment.
  const fileContent = await uploadReportFile(mx, reportRoom, report);
  const { event_id: threadRootId } = await mx.sendMessage(reportRoom.roomId, {
    msgtype: MsgType.Text,
    body: buildBugReportSummary(report, getReporterName(mx, report.reporter.userId)),
    [BUG_REPORT_TYPE]: {
      version: BUG_REPORT_VERSION,
      room_id: report.target.roomId,
      thread_id: report.target.threadId,
      event_id: report.target.eventId,
    },
  } as RoomMessageEventContent);

  await mx.sendMessage(reportRoom.roomId, threadRootId, {
    ...fileContent,
    'm.relates_to': getMessageRelation(undefined, undefined, threadRootId),
  } as RoomMessageEventContent);

  return { roomId: reportRoom.roomId, threadRootId };
};
