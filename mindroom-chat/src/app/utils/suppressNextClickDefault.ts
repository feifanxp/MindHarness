const CLICK_SUPPRESSION_WINDOW_MS = 750;

export const suppressNextClickDefault = (
  ownerDocument: Document | undefined = typeof document === 'undefined' ? undefined : document
): (() => void) => {
  if (!ownerDocument) return () => undefined;

  const ownerWindow = ownerDocument.defaultView;
  let timeoutId: number | undefined;
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    ownerDocument.removeEventListener('click', handleClick, true);
    if (timeoutId !== undefined) ownerWindow?.clearTimeout(timeoutId);
  };

  const handleClick = (evt: MouseEvent) => {
    if (evt.cancelable) evt.preventDefault();
    cleanup();
  };

  ownerDocument.addEventListener('click', handleClick, { capture: true });
  timeoutId = ownerWindow?.setTimeout(cleanup, CLICK_SUPPRESSION_WINDOW_MS);

  return cleanup;
};
