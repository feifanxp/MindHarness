import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createMemoryRouter, redirect, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ParticleBackgroundSurface,
  PersistentParticleBackgroundProvider,
} from './PersistentParticleBackground';

const lifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));

vi.mock('./MindRoomParticleBackground', async () => {
  const reactModule = await import('react');

  return {
    MindRoomParticleBackground: ({ position }: { position?: string }) => {
      reactModule.useLayoutEffect(() => {
        lifecycle.mounts += 1;
        return () => {
          lifecycle.unmounts += 1;
        };
      }, []);

      return reactModule.createElement('div', {
        'data-mindroom-particle-background': true,
        'data-position': position,
      });
    },
  };
});

vi.mock('./PersistentParticleBackground.css', () => ({
  PersistentParticleBackground: 'persistent-particle-background',
}));

describe('PersistentParticleBackground', () => {
  beforeEach(() => {
    lifecycle.mounts = 0;
    lifecycle.unmounts = 0;
  });

  it('keeps one renderer mounted while loading surfaces hand off', async () => {
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <PersistentParticleBackgroundProvider>
          <ParticleBackgroundSurface key="config" position="fixed" />
        </PersistentParticleBackgroundProvider>
      );
    });

    expect(lifecycle).toEqual({ mounts: 1, unmounts: 0 });

    await act(async () => {
      renderer!.update(
        <PersistentParticleBackgroundProvider>
          <ParticleBackgroundSurface key="client" position="fixed" />
        </PersistentParticleBackgroundProvider>
      );
      await Promise.resolve();
    });

    expect(lifecycle).toEqual({ mounts: 1, unmounts: 0 });

    await act(async () => {
      renderer!.update(
        <PersistentParticleBackgroundProvider>
          <div>Client ready</div>
        </PersistentParticleBackgroundProvider>
      );
      await Promise.resolve();
    });

    expect(lifecycle).toEqual({ mounts: 1, unmounts: 1 });
  });

  it('renders a local background when no persistent host exists', () => {
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(<ParticleBackgroundSurface position="absolute" />);
    });

    expect(
      renderer!.root.findByProps({
        'data-mindroom-particle-background': true,
        'data-position': 'absolute',
      })
    ).toBeDefined();
  });

  it('keeps the renderer through an asynchronous initial router redirect', async () => {
    let releaseInitialLoader: (() => void) | undefined;
    const initialLoader = new Promise<void>((resolve) => {
      releaseInitialLoader = resolve;
    });
    const router = createMemoryRouter(
      [
        {
          path: '/',
          loader: async () => {
            await initialLoader;
            return redirect('/login');
          },
        },
        {
          path: '/login',
          element: <ParticleBackgroundSurface position="fixed" />,
        },
      ],
      { initialEntries: ['/'] }
    );
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <PersistentParticleBackgroundProvider>
          <ParticleBackgroundSurface key="config" position="fixed" />
        </PersistentParticleBackgroundProvider>
      );
    });

    await act(async () => {
      renderer!.update(
        <PersistentParticleBackgroundProvider>
          <RouterProvider
            router={router}
            fallbackElement={<ParticleBackgroundSurface position="fixed" />}
          />
        </PersistentParticleBackgroundProvider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(lifecycle).toEqual({ mounts: 1, unmounts: 0 });

    await act(async () => {
      releaseInitialLoader?.();
      await new Promise<void>((resolve) => {
        if (router.state.initialized) {
          resolve();
          return;
        }
        const unsubscribe = router.subscribe((state) => {
          if (state.initialized) {
            unsubscribe();
            resolve();
          }
        });
      });
      await Promise.resolve();
    });

    expect(lifecycle).toEqual({ mounts: 1, unmounts: 0 });
  });
});
