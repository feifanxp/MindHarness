import React, { type ReactNode } from 'react';
import { MessageEditedContent } from '../../components/message/content/FallbackContent';
import { renderFailedSendIndicator, renderPendingSendIndicator } from './pendingSendIndicator';

export type MindroomMessageStateSuffixOptions = {
  edited?: boolean;
  pendingSend?: boolean;
  failedSend?: boolean;
  renderStateSuffix?: () => ReactNode;
};

export const getMindroomMessageStateSuffixRenderer = ({
  edited,
  pendingSend,
  failedSend,
  renderStateSuffix,
}: MindroomMessageStateSuffixOptions): (() => ReactNode) | undefined => {
  if (!renderStateSuffix && !pendingSend && !failedSend) {
    return undefined;
  }

  return () => (
    <>
      {renderStateSuffix?.()}
      {edited && <MessageEditedContent />}
      {failedSend ? renderFailedSendIndicator() : pendingSend && renderPendingSendIndicator()}
    </>
  );
};
