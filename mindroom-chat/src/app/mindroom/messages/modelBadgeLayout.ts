export const getMindroomModelBadgeMaxWidth = (
  avatarWidth: string,
  messageLayoutGap: string
): string => `calc(${avatarWidth} + ${messageLayoutGap} + ${messageLayoutGap})`;
