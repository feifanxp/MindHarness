import React from 'react';
import { enableMapSet } from 'immer';
import { act, create } from 'react-test-renderer';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavToActivePathProvider } from '../state/hooks/navToActivePath';
import { makeNavToActivePathAtom } from '../state/navToActivePath';
import { ScreenSize, ScreenSizeProvider } from './useScreenSize';
import { useNavToActivePathMapper } from './useNavToActivePathMapper';

let navigate: ReturnType<typeof useNavigate>;
const saved = new Map<string, string>();

function Mapper({
  navId,
  preserveMobileContent,
}: {
  navId: string;
  preserveMobileContent?: boolean;
}) {
  navigate = useNavigate();
  useNavToActivePathMapper(navId, preserveMobileContent);
  return null;
}

beforeEach(() => {
  enableMapSet();
  saved.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe('remembered navigation content', () => {
  it.each([
    ['home', true],
    ['direct', true],
    ['!space:example.org', true],
    ['inbox', false],
    ['explore', false],
  ] as const)(
    'records the intended path when opening the mobile %s list',
    (navId, preserveMobileContent) => {
      const atom = makeNavToActivePathAtom('@alice:example.org');
      const root = `/${encodeURIComponent(navId)}/`;
      const content = `${root}!room:example.org/?threadId=%24thread`;
      let renderer: ReturnType<typeof create>;
      act(() => {
        renderer = create(
          <MemoryRouter initialEntries={[content]}>
            <ScreenSizeProvider value={ScreenSize.Mobile}>
              <NavToActivePathProvider value={atom}>
                <Mapper navId={navId} preserveMobileContent={preserveMobileContent} />
              </NavToActivePathProvider>
            </ScreenSizeProvider>
          </MemoryRouter>
        );
      });
      act(() => navigate(root));
      const paths = JSON.parse(saved.get('navToActivePath@alice:example.org') ?? '{}');
      expect(paths[navId]).toEqual(
        preserveMobileContent
          ? { pathname: `${root}!room:example.org/`, search: '?threadId=%24thread', hash: '' }
          : { pathname: root, search: '', hash: '' }
      );
      act(() => renderer.unmount());
    }
  );
});
