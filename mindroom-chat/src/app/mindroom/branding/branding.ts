import MindRoomLogo from '../../../../public/res/branding/mindroom-logo.png';
import MindRoomFavicon from '../../../../public/res/branding/mindroom-favicon.png';

export const MINDROOM_APP_NAME = 'MindRoom Chat';
export const MINDROOM_DEVICE_DISPLAY_NAME = 'MindRoom Chat Web';
export const MINDROOM_NOTIFICATION_BRAND = MINDROOM_APP_NAME;

export const MINDROOM_SOURCE_URL = 'https://github.com/mindroom-ai/mindroom';
export const MINDROOM_CHAT_SOURCE_URL = 'https://github.com/mindroom-ai/mindroom-chat';
export const MINDROOM_DOCS_URL = 'https://docs.mindroom.chat/';

export const MINDROOM_LOGO_SRC = MindRoomLogo;
export const MINDROOM_LOGO_ALT = 'MindRoom Chat Logo';
export const MINDROOM_FAVICON_SRC = MindRoomFavicon;

export type MindroomPoweredByLink = {
  label: string;
  url: string;
};

export const MINDROOM_DEFAULT_POWERED_BY: MindroomPoweredByLink[] = [
  { label: 'MindRoom', url: MINDROOM_SOURCE_URL },
  { label: 'Matrix', url: 'https://matrix.org' },
  { label: 'Cinny', url: 'https://cinny.in' },
  { label: MINDROOM_APP_NAME, url: MINDROOM_CHAT_SOURCE_URL },
];
