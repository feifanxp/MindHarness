import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { Page, PageRoot } from './Page';
import { Modal } from '../glass/GlassPrimitives';

vi.unmock('../glass/GlassPrimitives');

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();
  return {
    ...actual,
    Line: () => React.createElement('hr', { 'data-testid': 'page-nav-divider' }),
  };
});

vi.mock('../../styles/ContainerColor.css', () => ({
  ContainerColor: ({ variant }: { variant: string }) => `color-${variant}`,
}));

vi.mock('./style.css', () => ({
  PageContent: '',
  PageContentCenter: '',
  PageHeader: () => '',
  PageHeroEmpty: '',
  PageHeroSection: '',
  PageNav: () => '',
  PageNavContent: '',
  PageNavHeader: '',
  PageNavHeaderScroll: '',
}));

vi.mock('../../hooks/useScreenSize', () => ({
  ScreenSize: {
    Desktop: 'Desktop',
    Mobile: 'Mobile',
  },
  useScreenSizeContext: () => 'Desktop',
}));

describe('PageRoot', () => {
  it('preserves page colors and reveals the enclosing surface only inside glass', () => {
    const renderLayout = (appearance: 'glass' | 'plain' | 'inherit') => (
      <Modal appearance={appearance}>
        <PageRoot nav={<nav />}>
          <Page data-testid="page-content">Settings</Page>
        </PageRoot>
      </Modal>
    );
    const layout = create(renderLayout('glass'));
    const pageRoot = () => layout.root.findByType(PageRoot).findByType('div');
    const page = () => layout.root.findByType(Page).findByType('div');
    expect(pageRoot().props.className).toContain('color-Background');
    expect(page().props.className).toContain('color-Surface');
    expect(pageRoot().props.className).toContain('surface-inherit');
    expect(page().props.className).toContain('surface-inherit');

    for (const appearance of ['plain', 'inherit'] as const) {
      layout.update(renderLayout(appearance));
      expect(pageRoot().props.className).not.toContain('surface-inherit');
      expect(page().props.className).not.toContain('surface-inherit');
    }
    layout.unmount();
  });

  it('removes the desktop navigation divider when navigation is absent', () => {
    const visible = create(
      <PageRoot nav={<nav data-testid="page-nav" />}>
        <main data-testid="page-content" />
      </PageRoot>
    );

    expect(visible.root.findAllByProps({ 'data-testid': 'page-nav' })).toHaveLength(1);
    expect(visible.root.findAllByProps({ 'data-testid': 'page-nav-divider' })).toHaveLength(1);

    const absent = create(
      <PageRoot nav={null}>
        <main data-testid="page-content" />
      </PageRoot>
    );

    expect(absent.root.findAllByProps({ 'data-testid': 'page-nav' })).toHaveLength(0);
    expect(absent.root.findAllByProps({ 'data-testid': 'page-nav-divider' })).toHaveLength(0);
    expect(absent.root.findAllByProps({ 'data-testid': 'page-content' })).toHaveLength(1);
  });
});
