import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import parse from 'html-react-parser';
import { MatrixClient } from 'matrix-js-sdk';
import { color, configClass, varsClass } from 'folds';
import '@fontsource/inter/variable.css';
import 'folds/dist/style.css';
import '../../src/index.css';
import '../../src/app/i18n';
import { darkTheme, lightTheme } from '../../src/colors.css';
import { useSpoilerClickHandler } from '../../src/app/hooks/useSpoilerClickHandler';
import {
  LINKIFY_OPTS,
  factoryRenderLinkifyWithMention,
  getReactCustomHtmlParser,
} from '../../src/app/plugins/react-custom-html-parser';

const dark = new URLSearchParams(window.location.search).has('dark');
document.documentElement.className = `${configClass} ${varsClass} ${dark ? darkTheme : lightTheme}`;
document.body.style.backgroundColor = color.Surface.Container;

function Fixture() {
  const [enabled, setEnabled] = useState(true);
  const [edited, setEdited] = useState(false);
  const handleSpoilerClick = useSpoilerClickHandler();
  const linkifyOpts = {
    ...LINKIFY_OPTS,
    render: factoryRenderLinkifyWithMention(() => undefined, enabled),
  };
  const opts = getReactCustomHtmlParser({} as MatrixClient, undefined, {
    linkifyOpts,
    showLinkFavicons: enabled,
    handleSpoilerClick,
  });
  const html = `<p>Open a PR https://github.com/example/chat/</p>
    <p>Read <a href="https://github.com/example/docs"><strong>the docs</strong></a> for details.</p>
    <p><a href="https://${edited ? 'github.com' : 'broken-site.com'}/">Updated link</a></p>
    <p><code>https://example.com/code</code> and <a href="mailto:alice@example.com">email</a></p>
    <p><span data-mx-spoiler=""><a href="https://secret.example.com/">Secret site</a></span></p>
    <p><a href="https://nested.example.com/"><span data-mx-spoiler="">Nested secret</span></a></p>
    <p><span data-mx-spoiler="">https://plain.example.com/</span></p>`;
  return (
    <main style={{ padding: 24, color: color.Surface.OnContainer, lineHeight: 1.5 }}>
      <button type="button" onClick={() => setEnabled(!enabled)}>
        Toggle previews
      </button>
      <button type="button" onClick={() => setEdited(true)}>
        Edit link
      </button>
      <section
        aria-label="Room messages"
        style={{ fontSize: 16, paddingBlock: 16, overflowWrap: 'anywhere' }}
      >
        {parse(html, opts)}
      </section>
      <section
        aria-label="Thread messages"
        dir="rtl"
        style={{ fontSize: 14, paddingBlock: 16, overflowWrap: 'anywhere' }}
      >
        {parse('<p>رابط <a href="https://github.com/example/thread">GitHub</a></p>', opts)}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
