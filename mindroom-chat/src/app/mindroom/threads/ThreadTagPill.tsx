import React from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from '../../styles/Motion.css';
import { transition } from '../../styles/transition';
import { tagColor, TAG_TEXT_COLOR } from './threadTagColor';

export interface ThreadTagPillProps {
  name: string;
  onRemove?: () => void; // undefined = read-only (no x button)
}

const pillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.2rem',
  fontSize: '0.65rem',
  fontWeight: 500,
  padding: '0.1rem 0.4rem',
  borderRadius: '0.5rem',
  maxWidth: '8rem',
  color: TAG_TEXT_COLOR,
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
  verticalAlign: 'middle',
};

const labelStyle: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const removeButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 0,
  fontSize: '0.6rem',
  lineHeight: 1,
  color: TAG_TEXT_COLOR,
  transition: transition(['opacity'], motion.duration.Normal),
  display: 'inline-flex',
  alignItems: 'center',
};

export function ThreadTagPill({ name, onRemove }: ThreadTagPillProps) {
  const { t } = useTranslation();
  return (
    <span
      style={{ ...pillStyle, backgroundColor: tagColor(name) }}
      title={name}
      className="thread-tag-pill"
    >
      <span style={labelStyle}>{name}</span>
      {onRemove && (
        <button
          type="button"
          style={removeButtonStyle}
          className="thread-tag-pill-remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={t('mindroomUi.threads.threadTagPill.removeTag', { tag: name })}
        >
          ×
        </button>
      )}
    </span>
  );
}
