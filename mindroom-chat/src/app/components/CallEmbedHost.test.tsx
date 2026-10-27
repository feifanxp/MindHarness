import React, { createRef } from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { CallEmbedHost } from './CallEmbedHost';

describe('CallEmbedHost', () => {
  it('stays childless for the iframe that CallEmbed appends imperatively', () => {
    const containerRef = createRef<HTMLDivElement>();
    const iframeHost = { kind: 'iframe-host' } as unknown as HTMLDivElement;
    const renderer = create(<CallEmbedHost visible containerRef={containerRef} />, {
      createNodeMock: (element) =>
        element.props['data-call-embed-container'] ? iframeHost : document.createElement('div'),
    });

    expect(containerRef.current).toBe(iframeHost);
    expect(renderer.root.findByProps({ 'data-call-embed-container': true }).children).toHaveLength(
      0
    );
  });
});
