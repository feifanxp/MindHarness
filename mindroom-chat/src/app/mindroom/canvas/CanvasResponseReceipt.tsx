import React from 'react';
import { Box, Icon, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { CANVAS_LABEL_MAX_LENGTH, type CanvasResponseReceipt as Receipt } from './canvasMessages';

// Inline styles keep this renderer free of a style module, like other message renderers.
// A non-list-item summary has no disclosure marker.
const summaryStyle: React.CSSProperties = {
  cursor: 'pointer',
  display: 'inline-flex',
  listStyle: 'none',
};
const dataStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  margin: '4px 0 0',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

/** A canvas commit reads as a short confirmation; clicking it reveals the exact data sent. */
type CanvasResponseReceiptProps = {
  receipt: Receipt;
  /** A local echo that is still sending, or failed, shows its send state instead of a check. */
  delivered: boolean;
  renderStateSuffix?: () => React.ReactNode;
};

export function CanvasResponseReceipt({
  receipt,
  delivered,
  renderStateSuffix,
}: CanvasResponseReceiptProps) {
  const { t } = useTranslation();
  return (
    <details data-canvas-receipt={receipt.canvasEventId}>
      <summary style={summaryStyle} title={t('mindroomUi.canvas.receiptData')}>
        <Box as="span" alignItems="Center" gap="100">
          {delivered && <Icon size="50" src={Icons.Check} />}
          <Text as="span" size="T300" priority="300">
            {receipt.label?.slice(0, CANVAS_LABEL_MAX_LENGTH) ?? t('mindroomUi.canvas.unlabeled')}
          </Text>
          {renderStateSuffix?.()}
        </Box>
      </summary>
      <Text as="pre" size="T200" style={dataStyle}>
        {receipt.json}
      </Text>
    </details>
  );
}
