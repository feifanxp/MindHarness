/* eslint-disable no-console */

export const MINDROOM_EDIT_DEBUG_STORAGE_KEY = 'mindroom.debug.edits';

export const isMindroomEditDebugEnabled = (): boolean => {
  try {
    const g = globalThis as {
      __MINDROOM_DEBUG_EDITS__?: boolean;
      localStorage?: Storage;
    };
    return (
      g.__MINDROOM_DEBUG_EDITS__ === true ||
      g.localStorage?.getItem(MINDROOM_EDIT_DEBUG_STORAGE_KEY) === '1'
    );
  } catch {
    return false;
  }
};

export const logMindroomEditDebug = (
  scope: string,
  details: Record<string, unknown>
) => {
  if (!isMindroomEditDebugEnabled()) return;
  console.info(`[mindroom-edits:${scope}]`, details);
};
