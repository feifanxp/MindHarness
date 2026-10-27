import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readReleaseVersion,
  resolveBuildVersion,
  resolveReleaseVersion,
} from '../scripts/build-version.mjs';

describe('build version selection', () => {
  it('prefers the explicit operator override', () => {
    expect(
      resolveBuildVersion({
        MINDROOM_BUILD_VERSION: ' release-candidate ',
        GITHUB_SHA: 'a'.repeat(40),
      })
    ).toBe('release-candidate');
  });

  it('uses provider commit hashes before a Netlify deploy ID', () => {
    expect(
      resolveBuildVersion({
        COMMIT_REF: ` ${'b'.repeat(40)} `,
        DEPLOY_ID: 'netlify-deploy-id',
      })
    ).toBe('b'.repeat(40));
  });

  it('uses the GitHub commit hash when no explicit version is provided', () => {
    expect(
      resolveBuildVersion({
        GITHUB_SHA: 'd'.repeat(40),
        DEPLOY_ID: 'netlify-deploy-id',
      })
    ).toBe('d'.repeat(40));
  });

  it('rejects branch-like provider values and uses the checked-out commit', () => {
    expect(
      resolveBuildVersion(
        {
          COMMIT_REF: 'feature/offline-updater',
          DEPLOY_ID: 'netlify-deploy-id',
        },
        'c'.repeat(40)
      )
    ).toBe('c'.repeat(40));
  });

  it('uses the deploy ID only when no Git commit is available', () => {
    expect(
      resolveBuildVersion({
        COMMIT_REF: 'feature/offline-updater',
        DEPLOY_ID: 'netlify-deploy-id',
      })
    ).toBe('netlify-deploy-id');
  });

  it('returns no version when every source is unavailable', () => {
    expect(resolveBuildVersion({})).toBeUndefined();
  });
});

describe('release version selection', () => {
  it('prefers the explicit release override', () => {
    expect(
      resolveReleaseVersion(
        { MINDROOM_RELEASE_VERSION: ' v4.12.6-mindroom.181 ' },
        '4.12.6',
        'v4.12.6-mindroom.180-1-gabcdef0'
      )
    ).toBe('v4.12.6-mindroom.181');
  });

  it('uses the described release tag when no override is provided', () => {
    expect(resolveReleaseVersion({}, '4.12.6', 'v4.12.6-mindroom.180\n')).toBe(
      'v4.12.6-mindroom.180'
    );
  });

  it('falls back to the package version when no release tag is reachable', () => {
    expect(resolveReleaseVersion({ MINDROOM_RELEASE_VERSION: ' ' }, '4.12.6', undefined)).toBe(
      'v4.12.6'
    );
  });
});

describe('release version from Git', () => {
  let repository: string | undefined;

  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.test',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'tag.gpgsign=false',
        ...args,
      ],
      { cwd: repository, stdio: 'ignore' }
    );

  const createRepository = () => {
    repository = mkdtempSync(path.join(tmpdir(), 'mindroom-release-version-'));
    writeFileSync(path.join(repository, 'package.json'), '{"version":"4.12.6"}\n');
    git('init', '--quiet');
    git('add', 'package.json');
    git('commit', '--quiet', '-m', 'initial');
  };

  afterEach(() => {
    if (repository) rmSync(repository, { recursive: true, force: true });
    repository = undefined;
  });

  it('uses the release tag on the checked-out commit', () => {
    createRepository();
    git('tag', 'v4.12.6-mindroom.180');

    expect(readReleaseVersion({}, repository)).toBe('v4.12.6-mindroom.180');
  });

  it('describes commits after the latest release tag like git describe', () => {
    createRepository();
    git('tag', 'v4.12.6-mindroom.180');
    git('commit', '--quiet', '--allow-empty', '-m', 'next');

    expect(readReleaseVersion({}, repository)).toMatch(/^v4\.12\.6-mindroom\.180-1-g[0-9a-f]{7,}$/);
  });

  it('ignores release tags for another base version', () => {
    createRepository();
    git('tag', 'v4.12.5-mindroom.179');

    expect(readReleaseVersion({}, repository)).toBe('v4.12.6');
  });
});
