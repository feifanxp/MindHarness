export const COMPUTER_INPUT_SELECTOR = '[data-mindroom-computer-input]';

const belongsToComputerSurface = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const closest = (value as { closest?: (selector: string) => Element | object | null }).closest;
  return typeof closest === 'function' && closest.call(value, COMPUTER_INPUT_SELECTOR) !== null;
};

export const computerOwnsKeyboardEvent = (event: Event): boolean =>
  (typeof event.composedPath === 'function' &&
    event.composedPath().some(belongsToComputerSurface)) ||
  belongsToComputerSurface(event.target);

export const computerOwnsKeyboardFocus = (): boolean =>
  typeof document !== 'undefined' && belongsToComputerSurface(document.activeElement);
