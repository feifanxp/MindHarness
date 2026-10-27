import { describe, expect, it } from 'vitest';
import { matchRoutes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SPACE_PATH, THREADS_PATH } from '../../../paths';
import { getThreadsPath } from '../../../pathUtils';

describe('Threads route', () => {
  it('uses the canonical top-level path helper', () => {
    expect(THREADS_PATH).toBe('/threads/');
    expect(getThreadsPath()).toBe('/threads/');
  });

  it('is registered before the space catch-all route', () => {
    const routerSource = readFileSync(resolve(process.cwd(), 'src/app/pages/Router.tsx'), 'utf8');

    const threadsIndex = routerSource.indexOf('path={THREADS_PATH}');
    const spaceIndex = routerSource.indexOf('path={SPACE_PATH}');

    expect(threadsIndex).toBeGreaterThan(-1);
    expect(spaceIndex).toBeGreaterThan(-1);
    expect(threadsIndex).toBeLessThan(spaceIndex);
  });

  it('keeps Threads in the mobile nav allow-list', () => {
    const mobileSource = readFileSync(
      resolve(process.cwd(), 'src/app/pages/MobileFriendly.tsx'),
      'utf8'
    );

    expect(mobileSource).toContain('THREADS_PATH');
    expect(mobileSource).toContain('threadsMatch');
  });

  it('matches /threads/ as the Threads route instead of the space catch-all', () => {
    const matches = matchRoutes(
      [
        { path: THREADS_PATH, id: 'threads' },
        { path: SPACE_PATH, id: 'space' },
      ],
      '/threads/'
    );

    expect(matches?.at(-1)?.route.id).toBe('threads');
  });
});
