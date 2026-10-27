import { useTranslation } from 'react-i18next';
import { Box, Spinner, Text } from 'folds';
import React, { ReactNode, useMemo } from 'react';
import { SplashScreen } from './SplashScreen';

export const DEFAULT_MINDROOM_SPLASH_MESSAGES = ['Loading MindRoom Chat'] as const;

export const pickMindRoomSplashMessage = (
  messages: readonly string[] | undefined,
  random: () => number = Math.random
): string => {
  const candidates =
    messages
      ?.map((message) => message.trim())
      .filter((message): message is string => message.length > 0) ?? [];
  const resolvedMessages =
    candidates.length > 0 ? candidates : [...DEFAULT_MINDROOM_SPLASH_MESSAGES];
  const index = Math.min(
    Math.floor(random() * resolvedMessages.length),
    resolvedMessages.length - 1
  );
  return resolvedMessages[index];
};

type MindRoomSplashScreenProps = {
  children?: ReactNode;
  loadingMessages?: readonly string[];
  message?: ReactNode;
  random?: () => number;
};

export function MindRoomSplashScreen({
  children,
  loadingMessages,
  message,
  random,
}: MindRoomSplashScreenProps) {
  const { t } = useTranslation();

  const selectedMessage = useMemo(
    () =>
      message ??
      pickMindRoomSplashMessage(
        loadingMessages?.some((text) => text.trim())
          ? loadingMessages
          : [t('sharedUi.mindRoomSplashScreen.loading')],
        random
      ),
    [loadingMessages, message, random, t]
  );

  return (
    <SplashScreen>
      <Box direction="Column" grow="Yes" alignItems="Center" justifyContent="Center" gap="400">
        <Spinner variant="Secondary" size="600" />
        <Text>{selectedMessage}</Text>
        {children}
      </Box>
    </SplashScreen>
  );
}
