import React from 'react';
import {
  IconBrandAws,
  IconBrandAzure,
  IconBrandGoogle,
  IconBrandMeta,
  IconBrandOpenai,
  IconRobot,
  IconSparkles,
  TablerIcon,
} from '@tabler/icons-react';

const ANTHROPIC_ICON_PATH =
  'M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z';
const CLAUDE_MODEL_ID_PATTERN = /(?:^|[./:])claude-/;
const GEMINI_MODEL_ID_PATTERN = /(?:^|[./:])gemini-/;

const isAnthropicModel = (provider?: string, id?: string): boolean => {
  const normalizedProvider = provider?.toLowerCase() ?? '';
  const normalizedId = id?.toLowerCase() ?? '';
  return (
    normalizedProvider.includes('anthropic') ||
    normalizedProvider.includes('claude') ||
    CLAUDE_MODEL_ID_PATTERN.test(normalizedId)
  );
};

const getProviderIcon = (provider?: string, id?: string): TablerIcon => {
  const normalizedProvider = provider?.toLowerCase() ?? '';
  if (GEMINI_MODEL_ID_PATTERN.test(id?.toLowerCase() ?? '')) return IconBrandGoogle;
  if (normalizedProvider.includes('openai') || normalizedProvider.includes('codex')) {
    return IconBrandOpenai;
  }
  if (normalizedProvider.includes('google') || normalizedProvider.includes('gemini')) {
    return IconBrandGoogle;
  }
  if (normalizedProvider.includes('meta')) return IconBrandMeta;
  if (normalizedProvider.includes('bedrock') || normalizedProvider.includes('aws')) {
    return IconBrandAws;
  }
  if (normalizedProvider.includes('azure')) return IconBrandAzure;
  if (normalizedProvider.includes('ollama') || normalizedProvider.includes('local')) {
    return IconRobot;
  }
  return IconSparkles;
};

export function ProviderModelIcon({
  provider,
  id,
  size,
  className,
}: {
  provider?: string;
  id?: string;
  size: number;
  className?: string;
}) {
  if (isAnthropicModel(provider, id)) {
    return (
      <svg
        className={className}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        focusable="false"
        aria-hidden="true"
      >
        <path d={ANTHROPIC_ICON_PATH} />
      </svg>
    );
  }

  const ProviderIcon = getProviderIcon(provider, id);
  return <ProviderIcon className={className} size={size} stroke={1.8} aria-hidden="true" />;
}
