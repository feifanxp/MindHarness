import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UrlPreviewCard } from './UrlPreviewCard';

const loadPreview = vi.fn<() => Promise<unknown>>();

vi.mock('folds', async () => {
  const reactModule = await import('react');

  const forwardTag = (tag: string) =>
    React.forwardRef<HTMLElement, Record<string, unknown>>(({ children, ...props }, ref) =>
      reactModule.createElement(tag, { ...props, ref }, children)
    );

  return {
    Box: forwardTag('div'),
    Icon: forwardTag('span'),
    IconButton: forwardTag('button'),
    Icons: {
      ArrowLeft: 'ArrowLeft',
      ArrowRight: 'ArrowRight',
    },
    Scroll: forwardTag('div'),
    Spinner: forwardTag('span'),
    Text: forwardTag('span'),
    as: <P extends object>(
      render: (props: P, ref: React.ForwardedRef<HTMLElement>) => React.ReactElement
    ) => React.forwardRef<HTMLElement, P>((props, ref) => render(props, ref)),
    color: {
      Success: {
        Main: 'green',
      },
    },
    config: {
      space: {
        S200: '8px',
      },
    },
  };
});

vi.mock('../../hooks/useAsyncCallback', () => ({
  AsyncStatus: {
    Idle: 'idle',
    Loading: 'loading',
    Success: 'success',
    Error: 'error',
  },
  useAsyncCallback: () => [
    {
      status: 'loading',
    },
    loadPreview,
  ],
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getUrlPreview: vi.fn(),
  }),
}));

vi.mock('./UrlPreview', () => ({
  UrlPreview: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ children, ...props }, ref) => React.createElement('div', { ...props, ref }, children)
  ),
  UrlPreviewContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  UrlPreviewDescription: ({ children }: { children: React.ReactNode }) =>
    React.createElement('span', null, children),
  UrlPreviewImg: (props: Record<string, unknown>) => React.createElement('img', props),
}));

vi.mock('../../hooks/useIntersectionObserver', () => ({
  getIntersectionObserverEntry: vi.fn(),
  useIntersectionObserver: vi.fn(),
}));

vi.mock('./UrlPreviewCard.css', () => ({}));

vi.mock('../ImageOverlay', () => ({
  ImageOverlay: () => null,
}));

vi.mock('../image-viewer', () => ({
  ImageViewer: () => null,
}));

vi.mock('../../utils/matrix', () => ({
  mxcUrlToHttp: vi.fn(() => undefined),
}));

vi.mock('../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

describe('UrlPreviewCard', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('swallows preview load rejection triggered from the effect', async () => {
    loadPreview.mockRejectedValueOnce(new Error('preview failed'));

    await expect(
      act(async () => {
        create(React.createElement(UrlPreviewCard, { url: 'https://example.com', ts: 1 }));
        await Promise.resolve();
      })
    ).resolves.toBeUndefined();

    expect(loadPreview).toHaveBeenCalledTimes(1);
  });
});
