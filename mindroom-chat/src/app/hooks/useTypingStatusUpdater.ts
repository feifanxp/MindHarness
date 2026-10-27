import { MatrixClient } from 'matrix-js-sdk';
import { useMemo, useRef } from 'react';
import { TYPING_TIMEOUT_MS } from '../state/typingMembers';

type TypingStatusUpdater = (typing: boolean) => void;

export const useTypingStatusUpdater = (mx: MatrixClient, roomId: string): TypingStatusUpdater => {
  const statusSentTsRef = useRef<number>(0);

  const sendTypingStatus: TypingStatusUpdater = useMemo(() => {
    statusSentTsRef.current = 0;
    // Typing notices are best effort; ignore failures such as a dropped connection.
    const sendTyping = (typing: boolean) =>
      mx.sendTyping(roomId, typing, TYPING_TIMEOUT_MS).catch(() => undefined);
    return (typing) => {
      if (typing) {
        if (Date.now() - statusSentTsRef.current < TYPING_TIMEOUT_MS) {
          return;
        }

        sendTyping(true);
        const sentTs = Date.now();
        statusSentTsRef.current = sentTs;

        // Don't believe server will timeout typing status;
        // Clear typing status after timeout if already not;
        setTimeout(() => {
          if (statusSentTsRef.current === sentTs) {
            sendTyping(false);
            statusSentTsRef.current = 0;
          }
        }, TYPING_TIMEOUT_MS);
        return;
      }

      if (Date.now() - statusSentTsRef.current < TYPING_TIMEOUT_MS) {
        sendTyping(false);
      }
      statusSentTsRef.current = 0;
    };
  }, [mx, roomId]);

  return sendTypingStatus;
};
