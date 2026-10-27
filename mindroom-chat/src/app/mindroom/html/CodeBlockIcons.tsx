import React, { CSSProperties, ReactNode } from 'react';
import {
  CODE_BLOCK_LANGUAGE_ICONS,
  CodeBlockIconPath,
  CodeBlockLanguageIconToken,
} from './codeBlockLanguageIconPaths';
import { getCodeBlockIconColors } from './codeBlockLanguage';
import * as css from '../../styles/CustomHtml.css';

// Toolbar glyphs from Lucide (ISC License, Copyright Lucide Contributors, with
// portions from Feather under the MIT License), the icon set T3 Code uses on its
// code block actions. License texts: CODE_BLOCK_ICONS_LICENSES.md.
function LucideIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      className={css.CodeBlockActionIcon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function CopyIcon() {
  return (
    <LucideIcon>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </LucideIcon>
  );
}

export function CheckIcon() {
  return (
    <LucideIcon>
      <path d="M20 6 9 17l-5-5" />
    </LucideIcon>
  );
}

export function WrapTextIcon() {
  return (
    <LucideIcon>
      <path d="m16 16-3 3 3 3" />
      <path d="M3 12h14.5a1 1 0 0 1 0 7H13" />
      <path d="M3 19h6" />
      <path d="M3 5h18" />
    </LucideIcon>
  );
}

export function ExpandIcon() {
  return (
    <LucideIcon>
      <path d="m7 15 5 5 5-5" />
      <path d="m7 9 5-5 5 5" />
    </LucideIcon>
  );
}

export function CollapseIcon() {
  return (
    <LucideIcon>
      <path d="m7 20 5-5 5 5" />
      <path d="m7 4 5 5 5-5" />
    </LucideIcon>
  );
}

export function CodeBlockLanguageIcon({ token }: { token: CodeBlockLanguageIconToken }) {
  const [light, dark] = getCodeBlockIconColors(token);
  // The stylesheet picks the light or dark tint from the theme's prism class.
  const style = { '--mr-code-icon-light': light, '--mr-code-icon-dark': dark } as CSSProperties;
  return (
    <svg
      className={css.CodeBlockLanguageIcon}
      style={style}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      data-code-icon={token}
    >
      {(CODE_BLOCK_LANGUAGE_ICONS[token] as readonly CodeBlockIconPath[]).map((path) => (
        <path
          key={path.d}
          d={path.d}
          opacity={path.opacity}
          fillRule={path.evenOdd && 'evenodd'}
          clipRule={path.evenOdd && 'evenodd'}
        />
      ))}
    </svg>
  );
}
