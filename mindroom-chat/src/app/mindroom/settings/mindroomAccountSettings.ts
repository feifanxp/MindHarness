/**
 * Account-level MindRoom settings — a single global dictionary stored in
 * Matrix account data under `io.mindroom.settings`, so preferences roam
 * across devices (unlike the localStorage-backed `mindroomSettingsAtom`).
 *
 * The stored content is intentionally open-shaped: readers sanitize only the
 * keys they know, and writers merge patches over the raw stored content so a
 * client that predates a key never destroys settings written by a newer one.
 */

export const MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE = 'io.mindroom.settings';

export type MindroomAccountSettings = {
  /**
   * Hide advanced UI (spaces, command palette, thread filter toolbar, …) for
   * non-technical users. Off means the full interface.
   */
  simpleMode: boolean;
  /** Show the sidebar's Canvases button (once there is a canvas) where the deployment has canvases. */
  showCanvasesInSidebar: boolean;
};

export const DEFAULT_MINDROOM_ACCOUNT_SETTINGS: MindroomAccountSettings = {
  simpleMode: true,
  showCanvasesInSidebar: true,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Coerce raw account-data content (which any client may have written) into a
 * well-formed settings object. Unknown or malformed values fall back to the
 * defaults — never throw over garbage in account data.
 */
export const sanitizeMindroomAccountSettings = (content: unknown): MindroomAccountSettings => {
  if (!isRecord(content)) return DEFAULT_MINDROOM_ACCOUNT_SETTINGS;
  return {
    simpleMode:
      typeof content.simpleMode === 'boolean'
        ? content.simpleMode
        : DEFAULT_MINDROOM_ACCOUNT_SETTINGS.simpleMode,
    showCanvasesInSidebar:
      typeof content.showCanvasesInSidebar === 'boolean'
        ? content.showCanvasesInSidebar
        : DEFAULT_MINDROOM_ACCOUNT_SETTINGS.showCanvasesInSidebar,
  };
};

/**
 * Overlay a patch of known settings onto the raw stored content, preserving
 * any keys this client does not understand.
 */
export const mergeMindroomAccountSettings = (
  content: unknown,
  patch: Partial<MindroomAccountSettings>
): Record<string, unknown> => ({
  ...(isRecord(content) ? content : {}),
  ...patch,
});
