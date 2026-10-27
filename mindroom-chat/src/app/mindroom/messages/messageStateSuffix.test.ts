import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { getMindroomMessageStateSuffixRenderer } from './messageStateSuffix';

vi.mock('./PendingSendIndicator.css', () => ({
  Container: 'PendingSendIndicator',
}));

const renderSuffix = (renderSuffixFn: (() => React.ReactNode) | undefined): string => {
  const renderer = create(React.createElement(React.Fragment, null, renderSuffixFn?.()));
  const rendered = JSON.stringify(renderer.toJSON());
  renderer.unmount();
  return rendered;
};

describe('getMindroomMessageStateSuffixRenderer', () => {
  it('preserves generic edited rendering when no custom suffix or pending indicator is needed', () => {
    expect(
      getMindroomMessageStateSuffixRenderer({
        edited: true,
        pendingSend: false,
      })
    ).toBeUndefined();
  });

  it('renders the pending send indicator when a message is pending', () => {
    const rendered = renderSuffix(
      getMindroomMessageStateSuffixRenderer({
        pendingSend: true,
      })
    );

    expect(rendered).toContain('Message sending');
    expect(rendered).toContain('Waiting for server');
  });

  it('composes custom suffixes with the pending send indicator', () => {
    const rendered = renderSuffix(
      getMindroomMessageStateSuffixRenderer({
        pendingSend: true,
        renderStateSuffix: () => React.createElement('span', { 'data-renderer': 'streaming' }),
      })
    );

    expect(rendered).toContain('streaming');
    expect(rendered).toContain('Message sending');
  });

  it('composes edited markers with the pending send indicator', () => {
    const rendered = renderSuffix(
      getMindroomMessageStateSuffixRenderer({
        edited: true,
        pendingSend: true,
      })
    );

    expect(rendered).toContain('(edited)');
    expect(rendered).toContain('Message sending');
  });

  it('composes custom suffixes, edited markers, and pending send indicators in order', () => {
    const rendered = renderSuffix(
      getMindroomMessageStateSuffixRenderer({
        edited: true,
        pendingSend: true,
        renderStateSuffix: () => React.createElement('span', { 'data-renderer': 'streaming' }),
      })
    );

    const customSuffixIndex = rendered.indexOf('streaming');
    const editedIndex = rendered.indexOf('(edited)');
    const pendingIndex = rendered.indexOf('Message sending');

    expect(customSuffixIndex).toBeGreaterThanOrEqual(0);
    expect(editedIndex).toBeGreaterThan(customSuffixIndex);
    expect(pendingIndex).toBeGreaterThan(editedIndex);
    expect(rendered).toContain('Waiting for server');
  });

  it('renders terminal failure instead of the pending indicator', () => {
    const rendered = renderSuffix(
      getMindroomMessageStateSuffixRenderer({
        pendingSend: true,
        failedSend: true,
      })
    );

    expect(rendered).toContain('Message failed to send');
    expect(rendered).toContain('Not sent');
    expect(rendered).not.toContain('Message sending');
  });
});
