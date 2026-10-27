import React from 'react';
import thinkingMark from './thinking-mark.svg?raw';

// WebKit drops gradient fills on <use> references into an external SVG.
// Keep the trusted, bundled artwork in this document, shared by every marker.
const artwork = thinkingMark
  .replace(/^[\s\S]*?<svg\b[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/\bid="([^"]+)"/g, 'id="mindroom-thinking-$1"')
  .replace(/url\(#([^)]+)\)/g, 'url(#mindroom-thinking-$1)')
  .replace(/href="#([^"]+)"/g, 'href="#mindroom-thinking-$1"');

function ThinkingDefinitions() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      style={{ position: 'absolute', overflow: 'hidden', pointerEvents: 'none' }}
    >
      {/* The markup comes only from the repository asset, never from messages or config. */}
      {/* eslint-disable-next-line react/no-danger */}
      <defs dangerouslySetInnerHTML={{ __html: artwork }} />
    </svg>
  );
}

export const MindroomThinkingDefinitions = React.memo(ThinkingDefinitions);
