import { useTranslation } from 'react-i18next';
import { Box, Icon, Icons, Text, as, color, config } from 'folds';
import React from 'react';

const warningStyle = { color: color.Warning.Main, opacity: config.opacity.P300 };
const criticalStyle = { color: color.Critical.Main, opacity: config.opacity.P300 };

export const MessageDeletedContent = as<'div', { children?: never; reason?: string }>(
  ({ reason, ...props }, ref) => {
    const { t } = useTranslation();
    return (
      <Box as="span" alignItems="Center" gap="100" style={warningStyle} {...props} ref={ref}>
        <Icon size="50" src={Icons.Delete} />
        {reason ? (
          <i>{t('sharedUi.fallbackContent.deletedWithReason', { reason })}</i>
        ) : (
          <i>{t('sharedUi.fallbackContent.thisMessageHasBeenDeleted')}</i>
        )}
      </Box>
    );
  }
);

export const MessageUnsupportedContent = as<'div', { children?: never }>(({ ...props }, ref) => {
  const { t } = useTranslation();
  return (
    <Box as="span" alignItems="Center" gap="100" style={criticalStyle} {...props} ref={ref}>
      <Icon size="50" src={Icons.Warning} />
      <i>{t('sharedUi.fallbackContent.unsupportedMessage')}</i>
    </Box>
  );
});

export const MessageFailedContent = as<'div', { children?: never }>(({ ...props }, ref) => {
  const { t } = useTranslation();
  return (
    <Box as="span" alignItems="Center" gap="100" style={criticalStyle} {...props} ref={ref}>
      <Icon size="50" src={Icons.Warning} />
      <i>{t('sharedUi.fallbackContent.failedToLoadMessage')}</i>
    </Box>
  );
});

export const MessageBadEncryptedContent = as<'div', { children?: never }>(({ ...props }, ref) => {
  const { t } = useTranslation();
  return (
    <Box as="span" alignItems="Center" gap="100" style={warningStyle} {...props} ref={ref}>
      <Icon size="50" src={Icons.Lock} />
      <i>{t('sharedUi.fallbackContent.couldnTDecryptThisMessageTheEncryptionKeyIsnTAvailable')}</i>
    </Box>
  );
});

export const MessageNotDecryptedContent = as<'div', { children?: never }>(({ ...props }, ref) => {
  const { t } = useTranslation();
  return (
    <Box as="span" alignItems="Center" gap="100" style={warningStyle} {...props} ref={ref}>
      <Icon size="50" src={Icons.Lock} />
      <i>{t('sharedUi.fallbackContent.thisMessageIsNotDecryptedYet')}</i>
    </Box>
  );
});

export const MessageBrokenContent = as<'div', { children?: never }>(({ ...props }, ref) => {
  const { t } = useTranslation();
  return (
    <Box as="span" alignItems="Center" gap="100" style={criticalStyle} {...props} ref={ref}>
      <Icon size="50" src={Icons.Warning} />
      <i>{t('sharedUi.fallbackContent.brokenMessage')}</i>
    </Box>
  );
});

export const MessageEmptyContent = as<'div', { children?: never }>(({ ...props }, ref) => {
  const { t } = useTranslation();
  return (
    <Box as="span" alignItems="Center" gap="100" style={criticalStyle} {...props} ref={ref}>
      <Icon size="50" src={Icons.Warning} />
      <i>{t('sharedUi.fallbackContent.emptyMessage')}</i>
    </Box>
  );
});

export const MessageEditedContent = as<'span', { children?: never }>(({ ...props }, ref) => {
  const { t } = useTranslation();
  return (
    <Text as="span" size="T200" priority="300" {...props} ref={ref}>
      {t('sharedUi.fallbackContent.edited')}
    </Text>
  );
});
