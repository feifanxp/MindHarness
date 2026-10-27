import { useTranslation } from 'react-i18next';
import { toSupportedLanguageCode } from '../i18nLanguages';

export const useAppLanguageCode = (): string => {
  const { i18n } = useTranslation();
  return toSupportedLanguageCode(i18n.resolvedLanguage ?? i18n.language);
};
