import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import {
  getMindroomEmailNotificationPusherData,
  MindroomNativeNotificationSettings,
} from './SystemNotificationMindroomExtensions';

vi.mock('../native/IOSPushNotification', () => ({
  IOSPushNotification: () => React.createElement('mock-ios-push-notification'),
}));

describe('SystemNotificationMindroomExtensions', () => {
  it('provides MindRoom Chat email pusher branding', () => {
    expect(getMindroomEmailNotificationPusherData()).toEqual({ brand: 'MindRoom Chat' });
  });

  it('mounts the MindRoom native notification settings component', () => {
    const renderer = create(React.createElement(MindroomNativeNotificationSettings));

    expect(renderer.root.findByType('mock-ios-push-notification')).toBeTruthy();
  });
});
