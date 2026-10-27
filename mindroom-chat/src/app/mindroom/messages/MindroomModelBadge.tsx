import React from 'react';
import { useTranslation } from 'react-i18next';
import { MindroomAiRunInfo } from './aiRun';
import { getMindroomAiRunCompactModelLabel, getMindroomAiRunModelLabel } from './aiRunDisplay';
import { ProviderModelIcon } from '../models/ProviderModelIcon';
import * as css from './MindroomModelBadge.css';

export function MindroomModelBadge({ info }: { info: MindroomAiRunInfo }) {
  const { t } = useTranslation();
  const label = getMindroomAiRunCompactModelLabel(info);
  if (!label) return null;

  const modelDetails = getMindroomAiRunModelLabel(info);
  const fullModelLabel =
    info.modelDisplayName && modelDetails && modelDetails !== label
      ? `${label} · ${modelDetails}`
      : modelDetails ?? label;

  return (
    <span
      className={css.Badge}
      title={fullModelLabel}
      aria-label={t('mindroomUi.messages.mindroomModelBadge.model', { model: fullModelLabel })}
    >
      <ProviderModelIcon
        provider={info.modelProvider}
        id={info.modelId}
        className={css.Icon}
        size={10}
      />
      <span className={css.Label}>{label}</span>
    </span>
  );
}
