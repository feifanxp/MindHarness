import React, { type ReactNode, useMemo } from 'react';
import {
  getMindroomLongTextSidecarFacts,
  getMindroomLongTextSourceIdentity,
  type MindroomLongTextSource,
} from '../messages/longText';
import { useMindroomLongTextResolvedContent } from '../messages/MindroomLongTextText';
import { isAllText, MINDROOM_SIDECAR_MAX_BYTES, readCanvasResponse } from './canvasMessages';
import { CanvasResponseReceipt } from './CanvasResponseReceipt';

type CanvasResponseSidecarReceiptProps = {
  source: MindroomLongTextSource;
  /** The event's own relation; MindRoom also ignores the one inside the uploaded file. */
  relation: unknown;
  hydrate: boolean;
  delivered: boolean;
  renderStateSuffix?: () => ReactNode;
  /** The ordinary long-text view, until (or unless) the downloaded content proves an answer. */
  fallback: ReactNode;
};

/** A canvas answer that was too large for one event, sent as a long-text sidecar. */
export function CanvasResponseSidecarReceipt({
  source,
  relation,
  hydrate,
  delivered,
  renderStateSuffix,
  fallback,
}: CanvasResponseSidecarReceiptProps) {
  // The parent builds a new source (and owner) object on every render; the download hook keys on
  // the object, so keep one per file and owner.
  const key = `${getMindroomLongTextSourceIdentity(source)}\n${JSON.stringify(
    source.owner ?? null
  )}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableSource = useMemo(() => source, [key]);
  const resolved = useMindroomLongTextResolvedContent(stableSource, hydrate);
  // Chat's reader accepts more files than MindRoom's; a receipt claims only what the agent reads,
  // so the file must be the content itself, within MindRoom's download limit, and valid text.
  const facts = resolved && getMindroomLongTextSidecarFacts(resolved);
  // MindRoom reads any m.new_content in the file as the message, so an answer must have none.
  const readByMindroom =
    resolved !== undefined &&
    !!facts?.topLevelContent &&
    facts.bytes <= MINDROOM_SIDECAR_MAX_BYTES &&
    resolved['m.new_content'] === undefined &&
    isAllText(resolved);
  const receipt = readByMindroom
    ? readCanvasResponse({ ...resolved, 'm.relates_to': relation })
    : undefined;
  if (!receipt) return <>{fallback}</>;
  return (
    <CanvasResponseReceipt
      receipt={receipt}
      delivered={delivered}
      renderStateSuffix={renderStateSuffix}
    />
  );
}
