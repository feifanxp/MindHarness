import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import parse from 'html-react-parser';
import { MatrixClient } from 'matrix-js-sdk';
import { color, configClass, varsClass } from 'folds';
import '@fontsource/inter/variable.css';
import 'folds/dist/style.css';
import '../../src/index.css';
import '../../src/app/i18n';
import { lightTheme } from '../../src/colors.css';
import { CollapsibleMessage } from '../../src/app/mindroom/threads/CollapsibleMessage';
import {
  getReactCustomHtmlParser,
  LINKIFY_OPTS,
} from '../../src/app/plugins/react-custom-html-parser';

document.documentElement.className = `${configClass} ${varsClass} ${lightTheme}`;
const parser = getReactCustomHtmlParser({} as MatrixClient, undefined, {
  linkifyOpts: LINKIFY_OPTS,
});
const code = Array.from(
  { length: 25 },
  (_, index) =>
    `const value${index} = "A long line that must remain horizontally scrollable on a phone";`
).join('\n');

function StreamingMessages() {
  const [lines, setLines] = useState(2);
  return (
    <section aria-label="Live responses">
      <button type="button" onClick={() => setLines(25)}>
        Long response
      </button>
      <button type="button" onClick={() => setLines(2)}>
        Short response
      </button>
      {Array.from({ length: 6 }, (_, index) => (
        <CollapsibleMessage
          key={index}
          collapseMode="initially-expanded"
          measurementKey={`response-${index}-${lines}`}
        >
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: '24px' }}>
            {Array.from({ length: lines }, (_, line) => `Response ${index}, line ${line}`).join(
              '\n'
            )}
          </div>
        </CollapsibleMessage>
      ))}
    </section>
  );
}

createRoot(document.getElementById('root')!).render(
  <main style={{ padding: 16, color: color.Surface.OnContainer, fontSize: 16 }}>
    {Array.from({ length: 12 }, (_, index) => (
      <section key={index}>{parse(`<pre><code>${code}</code></pre>`, parser)}</section>
    ))}
    <StreamingMessages />
  </main>
);
