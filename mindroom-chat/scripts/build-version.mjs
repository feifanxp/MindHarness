import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,64}$/i;

export const resolveBuildVersion = (environment, localCommit) => {
  const explicitVersion = environment.MINDROOM_BUILD_VERSION?.trim();
  if (explicitVersion) return explicitVersion;

  // GitHub's GITHUB_SHA and Netlify's COMMIT_REF are the documented commit
  // hashes (Netlify uses BRANCH for the branch name). Validate provider values
  // defensively before considering other sources.
  const providerCommit = [environment.GITHUB_SHA, environment.COMMIT_REF]
    .map((value) => value?.trim())
    .find((value) => value && COMMIT_HASH_PATTERN.test(value));
  if (providerCommit) return providerCommit;

  const checkedOutCommit = localCommit?.trim();
  if (checkedOutCommit) return checkedOutCommit;

  // A Netlify deploy ID is unique but is not a Git hash. Use it only when no
  // provider or local Git commit is available, such as for a manual upload.
  return environment.DEPLOY_ID?.trim() || undefined;
};

export const resolveReleaseVersion = (environment, packageVersion, describedRelease) => {
  const explicitVersion = environment.MINDROOM_RELEASE_VERSION?.trim();
  if (explicitVersion) return explicitVersion;

  return describedRelease?.trim() || `v${packageVersion}`;
};

// Release tags (`v<package version>-mindroom.<iteration>`) are created by the
// release workflow. `git describe` names the tag on HEAD, or the nearest one
// followed by the number of commits since it and the abbreviated commit.
export const readReleaseVersion = (environment, cwd) => {
  const { version: packageVersion } = JSON.parse(
    readFileSync(path.join(cwd, 'package.json'), 'utf8')
  );
  let describedRelease;
  try {
    describedRelease = execFileSync(
      'git',
      ['describe', '--tags', '--match', `v${packageVersion}-mindroom.*`],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
  } catch {
    // No release tag is reachable, such as in a shallow clone or without Git.
  }

  return resolveReleaseVersion(environment, packageVersion, describedRelease);
};
