import type { TFunction } from 'i18next';
import { MindroomAiRunInfo } from './aiRun';

export type MindroomAiRunContextBarSegment = {
  key: 'cacheRead' | 'newInput' | 'reserve';
  label: string;
  tokens: number;
  percentage: number;
  title: string;
};

export const formatMindroomAiRunNumber = (
  value: number | undefined,
  locale?: string
): string | undefined =>
  typeof value === 'number' ? Math.round(value).toLocaleString(locale) : undefined;

export const formatMindroomAiRunTimeToFirstToken = (
  value: number | undefined
): string | undefined => {
  if (typeof value !== 'number' || value < 0) return undefined;
  return `${Math.round(value * 1000)} ms`;
};

export const getMindroomAiRunModelLabel = (info: MindroomAiRunInfo): string | undefined => {
  const providerAndId = [info.modelProvider, info.modelId].filter(Boolean).join(' / ');
  if (info.modelConfig && providerAndId) return `${info.modelConfig} (${providerAndId})`;
  if (info.modelConfig) return info.modelConfig;
  return providerAndId || undefined;
};

const GENERIC_MODEL_CONFIGS = new Set(['auto', 'default']);

const titleCaseWords = (value: string): string =>
  value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');

const formatModelId = (modelId: string): string => {
  const claudeMatch = modelId.match(/claude-(?:\d+(?:[-.]\d+)*-)?(opus|sonnet|haiku)(?:-(.*))?/i);
  if (claudeMatch) {
    const family = titleCaseWords(claudeMatch[1]);
    const version = claudeMatch[2]?.replace(/-/g, '.').replace(/(?:^|\.)latest$/i, '');
    return version ? `${family} ${version}` : family;
  }

  if (/^gpt-/i.test(modelId)) return modelId.replace(/^gpt/i, 'GPT');
  return titleCaseWords(modelId.replace(/-/g, ' '));
};

/** A short, friendly model name intended for the always-visible message badge. */
export const getMindroomAiRunCompactModelLabel = (info: MindroomAiRunInfo): string | undefined => {
  if (info.modelDisplayName) return info.modelDisplayName;

  const modelConfig = info.modelConfig?.trim();
  if (modelConfig && !GENERIC_MODEL_CONFIGS.has(modelConfig.toLowerCase())) {
    return titleCaseWords(modelConfig);
  }

  const modelId = info.modelId?.trim();
  if (modelId) return formatModelId(modelId);

  const provider = info.modelProvider?.trim();
  return provider ? titleCaseWords(provider) : undefined;
};

export const getMindroomAiRunUsageLabel = (
  info: MindroomAiRunInfo,
  t?: TFunction,
  locale?: string
): string | undefined => {
  const parts = [
    info.inputTokens !== undefined
      ? t
        ? t('mindroomUi.messages.aiRunDisplay.inputTokens', {
            formattedCount: formatMindroomAiRunNumber(info.inputTokens, locale),
          })
        : `in ${formatMindroomAiRunNumber(info.inputTokens, locale)}`
      : undefined,
    info.outputTokens !== undefined
      ? t
        ? t('mindroomUi.messages.aiRunDisplay.outputTokens', {
            formattedCount: formatMindroomAiRunNumber(info.outputTokens, locale),
          })
        : `out ${formatMindroomAiRunNumber(info.outputTokens, locale)}`
      : undefined,
    info.totalTokens !== undefined
      ? t
        ? t('mindroomUi.messages.aiRunDisplay.totalTokens', {
            formattedCount: formatMindroomAiRunNumber(info.totalTokens, locale),
          })
        : `total ${formatMindroomAiRunNumber(info.totalTokens, locale)}`
      : undefined,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' • ') : undefined;
};

export const getMindroomAiRunUsageCacheLabel = (
  info: MindroomAiRunInfo,
  t?: TFunction,
  locale?: string
): string | undefined => {
  const parts = [
    info.cacheReadTokens !== undefined
      ? t
        ? t('mindroomUi.messages.aiRunDisplay.readTokens', {
            formattedCount: formatMindroomAiRunNumber(info.cacheReadTokens, locale),
          })
        : `read ${formatMindroomAiRunNumber(info.cacheReadTokens, locale)}`
      : undefined,
    info.cacheWriteTokens !== undefined
      ? t
        ? t('mindroomUi.messages.aiRunDisplay.writeTokens', {
            formattedCount: formatMindroomAiRunNumber(info.cacheWriteTokens, locale),
          })
        : `write ${formatMindroomAiRunNumber(info.cacheWriteTokens, locale)}`
      : undefined,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' • ') : undefined;
};

export const getMindroomAiRunContextLabel = (
  info: MindroomAiRunInfo,
  t?: TFunction,
  locale?: string
): string | undefined => {
  const inputTokens = info.contextInputTokens;
  const windowTokens = info.contextWindowTokens;
  if (inputTokens === undefined || windowTokens === undefined || windowTokens <= 0) {
    return undefined;
  }

  const percentage = formatMindroomAiRunContextBarPercentage(inputTokens, windowTokens, locale);
  const input = formatMindroomAiRunNumber(inputTokens, locale);
  const window = formatMindroomAiRunNumber(windowTokens, locale);
  return t
    ? t('mindroomUi.messages.aiRunDisplay.contextUsage', { input, window, percentage })
    : `${input} / ${window} (${percentage}%)`;
};

export const getMindroomAiRunContextCacheLabel = (
  info: MindroomAiRunInfo,
  t?: TFunction,
  locale?: string
): string | undefined => {
  const parts = [
    info.contextCacheReadInputTokens !== undefined
      ? t
        ? t('mindroomUi.messages.aiRunDisplay.readTokens', {
            formattedCount: formatMindroomAiRunNumber(info.contextCacheReadInputTokens, locale),
          })
        : `read ${formatMindroomAiRunNumber(info.contextCacheReadInputTokens, locale)}`
      : undefined,
    info.contextCacheWriteInputTokens !== undefined
      ? t
        ? t('mindroomUi.messages.aiRunDisplay.writeTokens', {
            formattedCount: formatMindroomAiRunNumber(info.contextCacheWriteInputTokens, locale),
          })
        : `write ${formatMindroomAiRunNumber(info.contextCacheWriteInputTokens, locale)}`
      : undefined,
    info.contextUncachedInputTokens !== undefined
      ? t
        ? t('mindroomUi.messages.aiRunDisplay.notReadTokens', {
            formattedCount: formatMindroomAiRunNumber(info.contextUncachedInputTokens, locale),
          })
        : `not read ${formatMindroomAiRunNumber(info.contextUncachedInputTokens, locale)}`
      : undefined,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' • ') : undefined;
};

const isValidContextBarTokenCount = (value: number | undefined): value is number =>
  typeof value === 'number' && value >= 0;

const formatMindroomAiRunContextBarPercentage = (
  value: number,
  windowTokens: number,
  locale?: string
): string =>
  new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
    (value / windowTokens) * 100
  );

const getMindroomAiRunContextBarTitle = (
  label: string,
  tokens: number,
  windowTokens: number,
  suffix?: string,
  t?: TFunction,
  locale?: string
): string => {
  const formattedCount = formatMindroomAiRunNumber(tokens, locale);
  const percentage = formatMindroomAiRunContextBarPercentage(tokens, windowTokens, locale);
  if (t) {
    return suffix
      ? t('mindroomUi.messages.aiRunDisplay.contextBarTitleWithSuffix', {
          label,
          count: tokens,
          formattedCount,
          percentage,
          suffix,
        })
      : t('mindroomUi.messages.aiRunDisplay.contextBarTitle', {
          label,
          count: tokens,
          formattedCount,
          percentage,
        });
  }
  const tokenLabel = tokens === 1 ? 'token' : 'tokens';
  return `${label}: ${formattedCount} ${tokenLabel} (${percentage}% of window)${
    suffix ? `; ${suffix}` : ''
  }`;
};

const getDisplayedCacheReadTokens = (cacheReadTokens: number | undefined, inputTokens: number) =>
  isValidContextBarTokenCount(cacheReadTokens) ? Math.min(cacheReadTokens, inputTokens) : 0;

const getCacheReadTitleSuffix = (
  reportedTokens: number | undefined,
  displayedTokens: number,
  t?: TFunction,
  locale?: string
) => {
  if (!isValidContextBarTokenCount(reportedTokens) || reportedTokens <= displayedTokens) {
    return undefined;
  }
  const formattedCount = formatMindroomAiRunNumber(reportedTokens, locale);
  return t
    ? t('mindroomUi.messages.aiRunDisplay.reportedCacheRead', {
        count: reportedTokens,
        formattedCount,
      })
    : `reported cache read: ${formattedCount} tokens`;
};

export const getMindroomAiRunContextBarSegments = (
  info: MindroomAiRunInfo,
  t?: TFunction,
  locale?: string
): MindroomAiRunContextBarSegment[] | undefined => {
  const inputTokens = info.contextInputTokens;
  const windowTokens = info.contextWindowTokens;
  const cacheReadTokens = info.contextCacheReadInputTokens;
  const uncachedTokens = info.contextUncachedInputTokens;

  if (
    !isValidContextBarTokenCount(inputTokens) ||
    !isValidContextBarTokenCount(windowTokens) ||
    windowTokens <= 0 ||
    inputTokens > windowTokens
  ) {
    return undefined;
  }

  const displayedCacheReadTokens = getDisplayedCacheReadTokens(cacheReadTokens, inputTokens);
  const displayedUncachedTokens =
    isValidContextBarTokenCount(cacheReadTokens) &&
    isValidContextBarTokenCount(uncachedTokens) &&
    cacheReadTokens + uncachedTokens === inputTokens
      ? uncachedTokens
      : inputTokens - displayedCacheReadTokens;
  const reserveTokens = windowTokens - inputTokens;
  const cacheWriteTokens = info.contextCacheWriteInputTokens;
  const cacheReadLabel = t ? t('mindroomUi.messages.aiRunDisplay.cacheRead') : 'Cache read';
  const newInputLabel = t ? t('mindroomUi.messages.aiRunDisplay.newInput') : 'New input';
  const reserveLabel = t ? t('mindroomUi.messages.aiRunDisplay.reserve') : 'Reserve';
  const cacheWriteSuffix = isValidContextBarTokenCount(cacheWriteTokens)
    ? t
      ? t('mindroomUi.messages.aiRunDisplay.cacheWrite', {
          count: cacheWriteTokens,
          formattedCount: formatMindroomAiRunNumber(cacheWriteTokens, locale),
        })
      : `cache write: ${formatMindroomAiRunNumber(cacheWriteTokens, locale)} tokens`
    : undefined;
  const cacheReadTitleSuffix = getCacheReadTitleSuffix(
    cacheReadTokens,
    displayedCacheReadTokens,
    t,
    locale
  );

  return [
    {
      key: 'cacheRead',
      label: cacheReadLabel,
      tokens: displayedCacheReadTokens,
      percentage: (displayedCacheReadTokens / windowTokens) * 100,
      title: getMindroomAiRunContextBarTitle(
        cacheReadLabel,
        displayedCacheReadTokens,
        windowTokens,
        cacheReadTitleSuffix,
        t,
        locale
      ),
    },
    {
      key: 'newInput',
      label: newInputLabel,
      tokens: displayedUncachedTokens,
      percentage: (displayedUncachedTokens / windowTokens) * 100,
      title: getMindroomAiRunContextBarTitle(
        newInputLabel,
        displayedUncachedTokens,
        windowTokens,
        cacheWriteSuffix,
        t,
        locale
      ),
    },
    {
      key: 'reserve',
      label: reserveLabel,
      tokens: reserveTokens,
      percentage: (reserveTokens / windowTokens) * 100,
      title: getMindroomAiRunContextBarTitle(
        reserveLabel,
        reserveTokens,
        windowTokens,
        undefined,
        t,
        locale
      ),
    },
  ];
};
