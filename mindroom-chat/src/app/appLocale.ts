import dayjs from 'dayjs';
import 'dayjs/locale/ar';
import 'dayjs/locale/bn';
import 'dayjs/locale/de';
import 'dayjs/locale/en';
import 'dayjs/locale/es';
import 'dayjs/locale/fr';
import 'dayjs/locale/hi';
import 'dayjs/locale/id';
import 'dayjs/locale/it';
import 'dayjs/locale/ja';
import 'dayjs/locale/ko';
import 'dayjs/locale/nl';
import 'dayjs/locale/pt';
import 'dayjs/locale/ru';
import 'dayjs/locale/tr';
import 'dayjs/locale/zh';
import 'dayjs/locale/zh-tw';
import { toSupportedLanguageCode } from './i18nLanguages';

const DAYJS_LANGUAGE_CODES: Record<string, string> = {
  'zh-TW': 'zh-tw',
};

export const syncDayjsLocale = (language: string | undefined): string => {
  const languageCode = toSupportedLanguageCode(language);
  dayjs.locale(DAYJS_LANGUAGE_CODES[languageCode] ?? languageCode);
  return languageCode;
};
