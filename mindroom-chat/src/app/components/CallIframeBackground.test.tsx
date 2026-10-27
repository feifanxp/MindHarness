// @vitest-environment jsdom

import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CallEmbed } from '../plugins/call';
import { CallIframeBackground, mountCallBackgroundPortal } from './CallIframeBackground';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('./particle-background', () => ({
  MindRoomParticleBackground: ({ selfContained }: { selfContained?: boolean }) =>
    React.createElement('div', { 'data-particle-background': selfContained ? 'embedded' : 'page' }),
}));

describe('mountCallBackgroundPortal', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('mounts behind the Element Call root and restores its stacking level', () => {
    const iframe = document.createElement('iframe');
    document.body.append(iframe);

    const callDocument = iframe.contentDocument!;
    const appRoot = callDocument.createElement('div');
    appRoot.id = 'root';
    appRoot.style.position = 'absolute';
    appRoot.style.zIndex = '4';
    callDocument.body.append(appRoot);

    const mounted = mountCallBackgroundPortal(iframe)!;

    expect(callDocument.body.firstElementChild).toBe(mounted.portalRoot);
    expect(mounted.portalRoot.dataset.mindroomCallBackground).toBe('');
    expect(mounted.portalRoot.style.position).toBe('fixed');
    expect(mounted.portalRoot.style.inset).toBe('0');
    expect(mounted.portalRoot.style.zIndex).toBe('0');
    const portalStyles = callDocument.head.querySelector('[data-mindroom-call-background-styles]');
    expect(portalStyles?.textContent).toContain('(prefers-reduced-motion: reduce)');
    expect(portalStyles?.textContent).toContain('canvas { display: none !important; }');
    expect(appRoot.style.position).toBe('relative');
    expect(appRoot.style.zIndex).toBe('0');

    mounted.cleanup();

    expect(mounted.portalRoot.isConnected).toBe(false);
    expect(portalStyles?.isConnected).toBe(false);
    expect(appRoot.style.position).toBe('absolute');
    expect(appRoot.style.zIndex).toBe('4');
  });

  it('keeps body-level Element Call portals above the production-shaped app root', () => {
    const iframe = document.createElement('iframe');
    document.body.append(iframe);

    const callDocument = iframe.contentDocument!;
    const appRoot = callDocument.createElement('div');
    appRoot.id = 'root';
    const participantTile = callDocument.createElement('div');
    participantTile.style.position = 'absolute';
    participantTile.style.zIndex = '1';
    appRoot.append(participantTile);
    callDocument.body.append(appRoot);

    const mounted = mountCallBackgroundPortal(iframe)!;
    const settingsPortal = callDocument.createElement('div');
    settingsPortal.setAttribute('role', 'dialog');
    settingsPortal.style.position = 'fixed';
    callDocument.body.append(settingsPortal);

    expect(Array.from(callDocument.body.children)).toEqual([
      mounted.portalRoot,
      appRoot,
      settingsPortal,
    ]);
    expect(callDocument.body.firstElementChild).toBe(mounted.portalRoot);
    expect(appRoot.style.position).toBe('relative');
    expect(appRoot.style.zIndex).toBe('0');
    expect(participantTile.style.zIndex).toBe('1');
    expect(settingsPortal.style.position).toBe('fixed');
    expect(settingsPortal.style.zIndex).toBe('');

    mounted.cleanup();
  });

  it('retries on iframe load and cleans up when the call becomes hidden', () => {
    const host = document.createElement('div');
    const iframe = document.createElement('iframe');
    document.body.append(host, iframe);

    const callDocument = iframe.contentDocument!;
    const reactRoot = createRoot(host);
    const callEmbed = { iframe } as CallEmbed;

    act(() => {
      reactRoot.render(<CallIframeBackground callEmbed={callEmbed} visible />);
    });
    expect(callDocument.querySelector('[data-mindroom-call-background]')).toBeNull();

    const appRoot = callDocument.createElement('div');
    appRoot.id = 'root';
    callDocument.body.append(appRoot);
    act(() => {
      iframe.dispatchEvent(new Event('load'));
    });
    expect(callDocument.querySelector('[data-particle-background="embedded"]')).not.toBeNull();

    act(() => {
      iframe.dispatchEvent(new Event('load'));
    });
    expect(callDocument.querySelectorAll('[data-mindroom-call-background]')).toHaveLength(1);
    expect(callDocument.querySelectorAll('[data-mindroom-call-background-styles]')).toHaveLength(1);

    act(() => {
      reactRoot.render(<CallIframeBackground callEmbed={callEmbed} visible={false} />);
    });
    expect(callDocument.querySelector('[data-mindroom-call-background]')).toBeNull();
    expect(appRoot.style.position).toBe('');
    expect(appRoot.style.zIndex).toBe('');

    act(() => {
      reactRoot.unmount();
    });
  });
});
