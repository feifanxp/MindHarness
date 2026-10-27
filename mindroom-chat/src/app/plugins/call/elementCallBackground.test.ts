// @vitest-environment jsdom

import { MatrixClient, Room } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { CallEmbed } from './CallEmbed';
import { ElementCallIntent } from './types';

describe('Element Call background', () => {
  it('layers the transparent iframe above the host animation', () => {
    const iframe = CallEmbed.getIframe('https://example.org/call', '通話');

    expect(iframe.title).toBe('通話');
    expect(iframe.style.backgroundColor).toBe('transparent');
    expect(iframe.style.position).toBe('relative');
    expect(iframe.style.zIndex).toBe('1');
  });

  it('passes the selected app language to a newly created call', () => {
    const mx = {
      baseUrl: 'https://matrix.example.org',
      getSafeUserId: () => '@alice:example.org',
      getDeviceId: () => 'DEVICE',
    } as unknown as MatrixClient;
    const room = {
      roomId: '!room:example.org',
      hasEncryptionStateEvent: () => false,
      isCallRoom: () => true,
    } as unknown as Room;

    const widget = CallEmbed.getWidget(mx, room, ElementCallIntent.StartCall, 'dark', 'fr');
    const url = new URL(widget.getCompleteUrl({ currentUserId: mx.getSafeUserId() }));

    expect(url.searchParams.get('lang')).toBe('fr');
  });

  it('uses the language tags supported by the embedded call bundle', () => {
    const mx = {
      baseUrl: 'https://matrix.example.org',
      getSafeUserId: () => '@alice:example.org',
      getDeviceId: () => 'DEVICE',
    } as unknown as MatrixClient;
    const room = {
      roomId: '!room:example.org',
      hasEncryptionStateEvent: () => false,
      isCallRoom: () => true,
    } as unknown as Room;

    const widget = CallEmbed.getWidget(mx, room, ElementCallIntent.StartCall, 'dark', 'zh-TW');
    const url = new URL(widget.getCompleteUrl({ currentUserId: mx.getSafeUserId() }));

    expect(url.searchParams.get('lang')).toBe('zh-Hant');
  });

  it('leaves unsupported app codes to the embedded call fallback', () => {
    const mx = {
      baseUrl: 'https://matrix.example.org',
      getSafeUserId: () => '@alice:example.org',
      getDeviceId: () => 'DEVICE',
    } as unknown as MatrixClient;
    const room = {
      roomId: '!room:example.org',
      hasEncryptionStateEvent: () => false,
      isCallRoom: () => true,
    } as unknown as Room;

    const widget = CallEmbed.getWidget(mx, room, ElementCallIntent.StartCall, 'dark', 'ko');
    const url = new URL(widget.getCompleteUrl({ currentUserId: mx.getSafeUserId() }));

    expect(url.searchParams.get('lang')).toBe('ko');
  });
});
