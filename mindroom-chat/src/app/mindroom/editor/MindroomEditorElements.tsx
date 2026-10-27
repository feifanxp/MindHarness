import { useTranslation } from 'react-i18next';
import React from 'react';
import { RenderElementProps, useFocused, useSelected } from 'slate-react';

import type { PasteMarkerElement } from '../../components/editor/slate';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';
import * as css from '../../styles/CustomHtml.css';

export function RenderMindroomEditorPasteMarkerElement({
  attributes,
  element,
  children,
}: { element: PasteMarkerElement } & RenderElementProps) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const selected = useSelected();
  const focused = useFocused();
  const charLabel = t('mindroomUi.editor.mindroomEditorElements.characterCount', {
    count: element.chars,
    formattedCount: element.chars.toLocaleString(language),
  });

  return (
    <span
      {...attributes}
      className={css.PasteMarker({
        focus: selected && focused,
      })}
      contentEditable={false}
      data-mindroom-paste-composer-badge
      title={element.marker}
    >
      <span>{t('mindroomUi.editor.mindroomEditorElements.pastedText')}</span>
      <span className={css.PasteMarkerMeta}>{element.id}</span>
      <span className={css.PasteMarkerMeta}>{charLabel}</span>
      <span className={css.PasteMarkerMeta}>{element.fileName}</span>
      {children}
    </span>
  );
}
