import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSingleAppTargetBuildSettingValue } from './ios-xcode-project.mjs';

const SEMVER_PREFIX_RE = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;
const INTEGER_RE = /^[0-9]+$/;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const parseBaseVersion = (version, label = 'version') => {
  const match = SEMVER_PREFIX_RE.exec(String(version ?? '').trim());
  if (!match) {
    throw new Error(`${label} must use a three-integer version such as 4.12.2.`);
  }
  return {
    raw: match[0],
    version: `${match[1]}.${match[2]}.${match[3]}`,
    parts: match.slice(1, 4).map((value) => Number.parseInt(value, 10)),
  };
};

export const compareBaseVersions = (left, right) => {
  const leftParts = parseBaseVersion(left, 'left version').parts;
  const rightParts = parseBaseVersion(right, 'right version').parts;

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }

  return 0;
};

export const assertMarketingVersionNotBehindPackage = (marketingVersion, packageVersion) => {
  const marketingBaseVersion = parseBaseVersion(marketingVersion, 'iOS MARKETING_VERSION').version;
  const packageBaseVersion = parseBaseVersion(packageVersion, 'package.json version').version;

  if (compareBaseVersions(marketingBaseVersion, packageBaseVersion) < 0) {
    throw new Error(
      `iOS MARKETING_VERSION ${marketingBaseVersion} must not be lower than package.json version ${packageBaseVersion}.`
    );
  }
};

export const deriveAutomatedMarketingVersion = (
  packageVersion,
  buildNumber,
  checkedInMarketingVersion
) => {
  const packageBaseVersion = parseBaseVersion(packageVersion, 'package.json version');
  assertBuildNumber(String(buildNumber), 'automated build counter');
  const checkedInVersion = parseBaseVersion(
    checkedInMarketingVersion,
    'checked-in iOS MARKETING_VERSION'
  );
  const counterBaseVersion =
    compareBaseVersions(packageBaseVersion.version, checkedInVersion.version) >= 0
      ? packageBaseVersion
      : checkedInVersion;
  const counter = Number.parseInt(buildNumber, 10);

  return `${counterBaseVersion.parts[0]}.${counterBaseVersion.parts[1]}.${
    counterBaseVersion.parts[2] + counter
  }`;
};

const getEnvValue = (env, key) => {
  const value = env[key];
  return typeof value === 'string' ? value.trim() : '';
};

const normalizeTagCandidate = (tag) =>
  String(tag ?? '')
    .trim()
    .replace(/^refs\/tags\//, '');

const getReleaseIteration = (tag, baseVersion) => {
  const normalizedTag = normalizeTagCandidate(tag);
  const escapedBaseVersion = baseVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^[vV]${escapedBaseVersion}-mindroom\\.([0-9]+)$`).exec(normalizedTag);

  if (!match) return null;

  return {
    tag: normalizedTag,
    iteration: Number.parseInt(match[1], 10),
    buildNumber: match[1],
  };
};

const getBestReleaseTag = (tags, baseVersion) =>
  tags
    .map((tag) => getReleaseIteration(tag, baseVersion))
    .filter(Boolean)
    .sort((left, right) => right.iteration - left.iteration)[0] ?? null;

const assertBuildNumber = (value, source) => {
  if (!INTEGER_RE.test(value)) {
    throw new Error(
      `iOS CURRENT_PROJECT_VERSION from ${source} must be an integer, got '${value}'.`
    );
  }
};

export const resolveIosCiVersionMetadata = ({
  env = process.env,
  packageVersion,
  checkedInMarketingVersion,
  checkedInBuildNumber,
  headTags = [],
}) => {
  const packageBaseVersion = parseBaseVersion(packageVersion, 'package.json version').version;
  const explicitMarketingVersion = getEnvValue(env, 'IOS_MARKETING_VERSION');
  const appStoreMarketingVersion = getEnvValue(env, 'APP_STORE_MARKETING_VERSION');
  const defaultMarketingVersion =
    explicitMarketingVersion ||
    appStoreMarketingVersion ||
    String(checkedInMarketingVersion ?? '').trim();
  const defaultMarketingVersionSource = explicitMarketingVersion
    ? 'IOS_MARKETING_VERSION'
    : appStoreMarketingVersion
    ? 'APP_STORE_MARKETING_VERSION'
    : 'checked-in Xcode project';

  const explicitBuildNumber = getEnvValue(env, 'IOS_BUILD_NUMBER');
  if (explicitBuildNumber) {
    assertBuildNumber(explicitBuildNumber, 'IOS_BUILD_NUMBER');
    assertMarketingVersionNotBehindPackage(defaultMarketingVersion, packageBaseVersion);
    return {
      marketingVersion: defaultMarketingVersion,
      marketingVersionSource: defaultMarketingVersionSource,
      buildNumber: explicitBuildNumber,
      buildNumberSource: 'IOS_BUILD_NUMBER',
    };
  }

  const ciBuildNumber = getEnvValue(env, 'CI_BUILD_NUMBER');
  if (ciBuildNumber) {
    assertBuildNumber(ciBuildNumber, 'CI_BUILD_NUMBER');
    const marketingVersion =
      explicitMarketingVersion ||
      appStoreMarketingVersion ||
      deriveAutomatedMarketingVersion(packageBaseVersion, ciBuildNumber, checkedInMarketingVersion);
    assertMarketingVersionNotBehindPackage(marketingVersion, packageBaseVersion);
    return {
      marketingVersion,
      marketingVersionSource: explicitMarketingVersion
        ? 'IOS_MARKETING_VERSION'
        : appStoreMarketingVersion
        ? 'APP_STORE_MARKETING_VERSION'
        : 'build-counter:CI_BUILD_NUMBER',
      buildNumber: ciBuildNumber,
      buildNumberSource: 'CI_BUILD_NUMBER',
    };
  }

  const envTag = getBestReleaseTag(
    [
      getEnvValue(env, 'CI_TAG'),
      getEnvValue(env, 'GITHUB_REF_NAME'),
      getEnvValue(env, 'RELEASE_TAG'),
      getEnvValue(env, 'GITHUB_REF'),
    ],
    packageBaseVersion
  );
  if (envTag) {
    assertMarketingVersionNotBehindPackage(defaultMarketingVersion, packageBaseVersion);
    return {
      marketingVersion: defaultMarketingVersion,
      marketingVersionSource: defaultMarketingVersionSource,
      buildNumber: envTag.buildNumber,
      buildNumberSource: `env-tag:${envTag.tag}`,
    };
  }

  const headTag = getBestReleaseTag(headTags, packageBaseVersion);
  if (headTag) {
    assertMarketingVersionNotBehindPackage(defaultMarketingVersion, packageBaseVersion);
    return {
      marketingVersion: defaultMarketingVersion,
      marketingVersionSource: defaultMarketingVersionSource,
      buildNumber: headTag.buildNumber,
      buildNumberSource: `head-tag:${headTag.tag}`,
    };
  }

  const fallbackBuildNumber = String(checkedInBuildNumber ?? '').trim();
  if (!fallbackBuildNumber) {
    throw new Error(
      'Could not determine iOS build number from IOS_BUILD_NUMBER, release tag, CI_BUILD_NUMBER, or the checked-in Xcode project.'
    );
  }
  assertBuildNumber(fallbackBuildNumber, 'checked-in Xcode project');
  assertMarketingVersionNotBehindPackage(defaultMarketingVersion, packageBaseVersion);

  return {
    marketingVersion: defaultMarketingVersion,
    marketingVersionSource: defaultMarketingVersionSource,
    buildNumber: fallbackBuildNumber,
    buildNumberSource: 'checked-in Xcode project',
  };
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const readHeadTags = (repoRoot) => {
  try {
    return execFileSync('git', ['tag', '--points-at', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .map((tag) => tag.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
};

const main = () => {
  const repoRoot = path.resolve(__dirname, '..');
  const packageJson = readJson(path.join(repoRoot, 'package.json'));
  const xcodeProjectPath = path.join(repoRoot, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
  const xcodeProject = fs.readFileSync(xcodeProjectPath, 'utf8');

  const metadata = resolveIosCiVersionMetadata({
    env: process.env,
    packageVersion: packageJson.version,
    checkedInMarketingVersion: getSingleAppTargetBuildSettingValue(
      xcodeProject,
      'MARKETING_VERSION'
    ),
    checkedInBuildNumber: getSingleAppTargetBuildSettingValue(
      xcodeProject,
      'CURRENT_PROJECT_VERSION'
    ),
    headTags: readHeadTags(repoRoot),
  });

  console.log(`marketing_version=${metadata.marketingVersion}`);
  console.log(`marketing_version_source=${metadata.marketingVersionSource}`);
  console.log(`build_number=${metadata.buildNumber}`);
  console.log(`build_number_source=${metadata.buildNumberSource}`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
