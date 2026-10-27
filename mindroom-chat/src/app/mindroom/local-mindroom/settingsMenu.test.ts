import { describe, expect, it } from 'vitest';
import { getLocalMindroomSettingsMenuItem } from './settingsMenu';
import { LOCAL_MINDROOM_SETTINGS_PAGE } from './settingsPage';

describe('getLocalMindroomSettingsMenuItem', () => {
  it('owns the Local MindRoom settings menu entry', () => {
    expect(getLocalMindroomSettingsMenuItem()).toMatchObject({
      page: LOCAL_MINDROOM_SETTINGS_PAGE,
      name: 'Local MindRoom',
    });
  });
});
