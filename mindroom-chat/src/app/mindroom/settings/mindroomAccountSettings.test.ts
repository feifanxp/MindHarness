import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MINDROOM_ACCOUNT_SETTINGS,
  mergeMindroomAccountSettings,
  sanitizeMindroomAccountSettings,
} from './mindroomAccountSettings';

describe('sanitizeMindroomAccountSettings', () => {
  it('falls back to defaults for non-object content', () => {
    expect(sanitizeMindroomAccountSettings(undefined)).toEqual(DEFAULT_MINDROOM_ACCOUNT_SETTINGS);
    expect(sanitizeMindroomAccountSettings(null)).toEqual(DEFAULT_MINDROOM_ACCOUNT_SETTINGS);
    expect(sanitizeMindroomAccountSettings('simple')).toEqual(DEFAULT_MINDROOM_ACCOUNT_SETTINGS);
    expect(sanitizeMindroomAccountSettings([true])).toEqual(DEFAULT_MINDROOM_ACCOUNT_SETTINGS);
  });

  it('defaults to Simple Mode while preserving explicit booleans', () => {
    expect(DEFAULT_MINDROOM_ACCOUNT_SETTINGS.simpleMode).toBe(true);
    expect(sanitizeMindroomAccountSettings({}).simpleMode).toBe(true);
    expect(sanitizeMindroomAccountSettings({ simpleMode: true }).simpleMode).toBe(true);
    expect(sanitizeMindroomAccountSettings({ simpleMode: false }).simpleMode).toBe(false);
    expect(sanitizeMindroomAccountSettings({ simpleMode: 0 }).simpleMode).toBe(true);
    expect(sanitizeMindroomAccountSettings({ simpleMode: '' }).simpleMode).toBe(true);
  });

  it('shows Canvases in the sidebar by default while preserving explicit booleans', () => {
    expect(DEFAULT_MINDROOM_ACCOUNT_SETTINGS.showCanvasesInSidebar).toBe(true);
    expect(sanitizeMindroomAccountSettings({}).showCanvasesInSidebar).toBe(true);
    expect(
      sanitizeMindroomAccountSettings({ showCanvasesInSidebar: false }).showCanvasesInSidebar
    ).toBe(false);
    expect(
      sanitizeMindroomAccountSettings({ showCanvasesInSidebar: 'no' }).showCanvasesInSidebar
    ).toBe(true);
  });

  it('ignores unknown keys when reading', () => {
    expect(
      sanitizeMindroomAccountSettings({
        simpleMode: true,
        futureKey: 'x',
        expandLongMessagesByDefault: true,
      })
    ).toEqual({
      simpleMode: true,
      showCanvasesInSidebar: true,
    });
  });
});

describe('mergeMindroomAccountSettings', () => {
  it('overlays the patch onto stored content', () => {
    expect(mergeMindroomAccountSettings({ simpleMode: false }, { simpleMode: true })).toEqual({
      simpleMode: true,
    });
  });

  it('preserves unknown keys written by other clients', () => {
    expect(
      mergeMindroomAccountSettings(
        { simpleMode: false, futureKey: { nested: 1 } },
        { simpleMode: true }
      )
    ).toEqual({ simpleMode: true, futureKey: { nested: 1 } });
  });

  it('treats malformed stored content as empty', () => {
    expect(mergeMindroomAccountSettings(undefined, { simpleMode: true })).toEqual({
      simpleMode: true,
    });
    expect(mergeMindroomAccountSettings('garbage', { simpleMode: true })).toEqual({
      simpleMode: true,
    });
  });
});
