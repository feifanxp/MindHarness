import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageLink } from './MessageLink';

afterEach(() => vi.useRealTimers());

describe('MessageLink', () => {
  it.each([
    'mailto:alice@example.com',
    'ftp://example.com/file',
    '#section',
    '/relative',
    'https://localhost/path',
    'http://192.168.1.2/path',
    'http://2130706433/path',
    'https://[::1]/path',
    'https://printer.lan/path',
    'https://work.internal/path',
    'https://name.local/path',
    'https://hidden.onion/path',
    'https://host.test/path',
    'https://user:password@example.com/path',
    'https://example.com:8443/path',
    'https://matrix.to/#/!room:example.com',
    'invalid',
  ])('does not send non-web or private destinations to the icon service: %s', (href) => {
    const renderer = create(
      <MessageLink href={href} showFavicon>
        Link
      </MessageLink>
    );
    expect(renderer.root.findAllByType('img')).toHaveLength(0);
    expect(renderer.root.findByType('a').props.href).toBe(href);
    renderer.unmount();
  });

  it('canonicalizes the hostname and preserves link behavior and readable text', () => {
    const onClick = vi.fn();
    const renderer = create(
      <MessageLink
        href="http://GitHub.COM./one?q=value#part"
        showFavicon
        target="_blank"
        rel="noreferrer noopener"
        onClick={onClick}
      >
        Docs
      </MessageLink>
    );
    const img = renderer.root.findByType('img');
    expect(img.props.src).toBe('https://icons.duckduckgo.com/ip3/github.com.ico');
    expect(img.props.alt).toBe('');
    expect(img.props.referrerPolicy).toBe('no-referrer');
    expect(img.props.loading).toBe('lazy');
    expect(renderer.root.findByType('a').props).toMatchObject({
      target: '_blank',
      rel: 'noreferrer noopener',
      onClick,
    });
    expect(renderer.root.findByType('a').children.at(-1)).toBe('Docs');
    renderer.unmount();
  });

  it('sets the referrer policy before the icon source', () => {
    // React DOM applies props in order, and Chromium can start a memory-cached
    // image request as soon as src is set, before later attributes exist.
    const renderer = create(
      <MessageLink href="https://github.com" showFavicon>
        Docs
      </MessageLink>
    );
    const props = Object.keys(renderer.root.findByType('img').props);
    expect(props.indexOf('referrerPolicy')).toBeLessThan(props.indexOf('src'));
    expect(props.indexOf('loading')).toBeLessThan(props.indexOf('src'));
    renderer.unmount();
  });

  it('hides broken icons, backs off across remounts, and recovers for an edited URL', () => {
    vi.useFakeTimers();
    const link = (href: string) => (
      <MessageLink href={href} showFavicon>
        Docs
      </MessageLink>
    );
    const renderer = create(link('https://failed-site.com/one'));
    act(() => renderer.root.findByType('img').props.onError());
    expect(renderer.root.findAllByType('img')).toHaveLength(0);
    expect(renderer.toJSON()).toMatchObject({ children: ['Docs'] });
    renderer.unmount();
    const remounted = create(link('https://failed-site.com/two'));
    expect(remounted.root.findAllByType('img')).toHaveLength(0);
    act(() => remounted.update(link('https://github.com/edited')));
    expect(remounted.root.findByType('img').props.src).toContain('/github.com.ico');
    remounted.unmount();
    vi.advanceTimersByTime(5 * 60 * 1000);
    const retried = create(link('https://failed-site.com/three'));
    expect(retried.root.findAllByType('img')).toHaveLength(1);
    retried.unmount();
  });

  it('responds to preview settings without removing the link', () => {
    const renderer = create(<MessageLink href="https://github.com">Docs</MessageLink>);
    expect(renderer.root.findAllByType('img')).toHaveLength(0);
    act(() =>
      renderer.update(
        <MessageLink href="https://github.com" showFavicon>
          Docs
        </MessageLink>
      )
    );
    expect(renderer.root.findAllByType('img')).toHaveLength(1);
    act(() => renderer.update(<MessageLink href="https://github.com">Docs</MessageLink>));
    expect(renderer.root.findAllByType('img')).toHaveLength(0);
    expect(renderer.root.findByType('a').children).toEqual(['Docs']);
    renderer.unmount();
  });
});
