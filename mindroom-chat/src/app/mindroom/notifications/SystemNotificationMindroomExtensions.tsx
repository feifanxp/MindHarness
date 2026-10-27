import React from 'react';

import { MINDROOM_NOTIFICATION_BRAND } from '../branding/branding';
import { IOSPushNotification } from '../native/IOSPushNotification';

export const getMindroomEmailNotificationPusherData = (): Record<string, string> => ({
  brand: MINDROOM_NOTIFICATION_BRAND,
});

export function MindroomNativeNotificationSettings() {
  return <IOSPushNotification />;
}
