import { describe, expect, it } from 'vitest';

import {
  assertMarketingVersionNotBehindPackage,
  resolveIosCiVersionMetadata,
} from '../../../../scripts/ios-ci-version.mjs';

describe('resolveIosCiVersionMetadata', () => {
  it('keeps the checked-in marketing version for release-tag builds outside Xcode Cloud', () => {
    const metadata = resolveIosCiVersionMetadata({
      env: {},
      packageVersion: '4.12.2',
      checkedInMarketingVersion: '4.12.2',
      checkedInBuildNumber: '80',
      headTags: ['v4.12.2-mindroom.18'],
    });

    expect(metadata).toEqual({
      marketingVersion: '4.12.2',
      marketingVersionSource: 'checked-in Xcode project',
      buildNumber: '18',
      buildNumberSource: 'head-tag:v4.12.2-mindroom.18',
    });
  });

  it('keeps an explicit iOS build number override ahead of release tags', () => {
    const metadata = resolveIosCiVersionMetadata({
      env: { CI_BUILD_NUMBER: '999', IOS_BUILD_NUMBER: '123' },
      packageVersion: '4.12.2',
      checkedInMarketingVersion: '4.12.2',
      checkedInBuildNumber: '80',
      headTags: ['v4.12.2-mindroom.18'],
    });

    expect(metadata.buildNumber).toBe('123');
    expect(metadata.buildNumberSource).toBe('IOS_BUILD_NUMBER');
    expect(metadata.marketingVersion).toBe('4.12.2');
    expect(metadata.marketingVersionSource).toBe('checked-in Xcode project');
  });

  it('uses CI release tag variables before tags fetched at HEAD', () => {
    const metadata = resolveIosCiVersionMetadata({
      env: { GITHUB_REF: 'refs/tags/v4.12.2-mindroom.19' },
      packageVersion: '4.12.2',
      checkedInMarketingVersion: '4.12.2',
      checkedInBuildNumber: '80',
      headTags: ['v4.12.2-mindroom.18'],
    });

    expect(metadata.buildNumber).toBe('19');
    expect(metadata.buildNumberSource).toBe('env-tag:v4.12.2-mindroom.19');
    expect(metadata.marketingVersion).toBe('4.12.2');
  });

  it('uses the auto-incrementing Xcode Cloud build number ahead of release tags', () => {
    const metadata = resolveIosCiVersionMetadata({
      env: { CI: 'TRUE', CI_BUILD_NUMBER: '124' },
      packageVersion: '4.12.2',
      checkedInMarketingVersion: '4.12.2',
      checkedInBuildNumber: '80',
      headTags: ['v4.12.2-mindroom.18'],
    });

    expect(metadata.buildNumber).toBe('124');
    expect(metadata.buildNumberSource).toBe('CI_BUILD_NUMBER');
    expect(metadata.marketingVersion).toBe('4.12.126');
    expect(metadata.marketingVersionSource).toBe('build-counter:CI_BUILD_NUMBER');
  });

  it('keeps Xcode Cloud marketing versions monotonic across package patch releases', () => {
    const previous = resolveIosCiVersionMetadata({
      env: { CI: 'TRUE', CI_BUILD_NUMBER: '124' },
      packageVersion: '4.12.2',
      checkedInMarketingVersion: '4.12.3',
      checkedInBuildNumber: '80',
      headTags: ['v4.12.2-mindroom.26'],
    });
    const next = resolveIosCiVersionMetadata({
      env: { CI: 'TRUE', CI_BUILD_NUMBER: '125' },
      packageVersion: '4.12.3',
      checkedInMarketingVersion: '4.12.4',
      checkedInBuildNumber: '33',
      headTags: ['v4.12.3-mindroom.1'],
    });

    expect(previous.marketingVersion).toBe('4.12.127');
    expect(next.marketingVersion).toBe('4.12.129');
  });

  it('uses a newer checked-in marketing version as the automated counter base', () => {
    const metadata = resolveIosCiVersionMetadata({
      env: { CI: 'TRUE', CI_BUILD_NUMBER: '1' },
      packageVersion: '4.12.3',
      checkedInMarketingVersion: '4.12.10',
      checkedInBuildNumber: '33',
      headTags: ['v4.12.3-mindroom.36'],
    });

    expect(metadata.marketingVersion).toBe('4.12.11');
    expect(metadata.marketingVersionSource).toBe('build-counter:CI_BUILD_NUMBER');
    expect(metadata.buildNumber).toBe('1');
  });

  it('keeps consecutive low counters increasing across the checked-in version floor', () => {
    const marketingVersions = Array.from(
      { length: 10 },
      (_value, index) =>
        resolveIosCiVersionMetadata({
          env: { CI: 'TRUE', CI_BUILD_NUMBER: String(index + 1) },
          packageVersion: '4.12.3',
          checkedInMarketingVersion: '4.12.10',
          checkedInBuildNumber: '33',
          headTags: [],
        }).marketingVersion
    );

    expect(marketingVersions).toEqual(
      Array.from({ length: 10 }, (_value, index) => `4.12.${index + 11}`)
    );
  });

  it('keeps consecutive counters increasing across a checked-in minor-version transition', () => {
    const marketingVersions = ['1', '2'].map(
      (buildNumber) =>
        resolveIosCiVersionMetadata({
          env: { CI: 'TRUE', CI_BUILD_NUMBER: buildNumber },
          packageVersion: '4.12.3',
          checkedInMarketingVersion: '4.13.2',
          checkedInBuildNumber: '33',
          headTags: [],
        }).marketingVersion
    );

    expect(marketingVersions).toEqual(['4.13.3', '4.13.4']);
  });

  it.each([
    {
      description: 'checked-in major version',
      packageVersion: '4.12.3',
      checkedInMarketingVersion: '5.0.2',
      expected: ['5.0.3', '5.0.4'],
    },
    {
      description: 'package major version',
      packageVersion: '5.0.0',
      checkedInMarketingVersion: '4.13.9',
      expected: ['5.0.1', '5.0.2'],
    },
  ])('uses the newer $description as the counter base', (testCase) => {
    const marketingVersions = ['1', '2'].map(
      (buildNumber) =>
        resolveIosCiVersionMetadata({
          env: { CI: 'TRUE', CI_BUILD_NUMBER: buildNumber },
          packageVersion: testCase.packageVersion,
          checkedInMarketingVersion: testCase.checkedInMarketingVersion,
          checkedInBuildNumber: '33',
          headTags: [],
        }).marketingVersion
    );

    expect(marketingVersions).toEqual(testCase.expected);
  });

  it.each(['IOS_MARKETING_VERSION', 'APP_STORE_MARKETING_VERSION'])(
    'keeps an explicit %s override in the Xcode Cloud counter path',
    (marketingVersionKey) => {
      const metadata = resolveIosCiVersionMetadata({
        env: { CI: 'TRUE', CI_BUILD_NUMBER: '1', [marketingVersionKey]: '4.12.4' },
        packageVersion: '4.12.3',
        checkedInMarketingVersion: '4.13.2',
        checkedInBuildNumber: '33',
        headTags: [],
      });

      expect(metadata.marketingVersion).toBe('4.12.4');
      expect(metadata.marketingVersionSource).toBe(marketingVersionKey);
      expect(metadata.buildNumber).toBe('1');
      expect(metadata.buildNumberSource).toBe('CI_BUILD_NUMBER');
    }
  );

  it('does not reuse a reset release iteration as an automatic marketing counter', () => {
    const metadata = resolveIosCiVersionMetadata({
      env: {},
      packageVersion: '4.12.3',
      checkedInMarketingVersion: '4.12.4',
      checkedInBuildNumber: '33',
      headTags: ['v4.12.3-mindroom.1'],
    });

    expect(metadata.marketingVersion).toBe('4.12.4');
    expect(metadata.marketingVersionSource).toBe('checked-in Xcode project');
    expect(metadata.buildNumber).toBe('1');
  });

  it('keeps explicit marketing and build overrides for manual releases', () => {
    const metadata = resolveIosCiVersionMetadata({
      env: { IOS_MARKETING_VERSION: '5.0.0', IOS_BUILD_NUMBER: '7' },
      packageVersion: '4.12.2',
      checkedInMarketingVersion: '4.12.2',
      checkedInBuildNumber: '80',
      headTags: ['v4.12.2-mindroom.18'],
    });

    expect(metadata).toEqual({
      marketingVersion: '5.0.0',
      marketingVersionSource: 'IOS_MARKETING_VERSION',
      buildNumber: '7',
      buildNumberSource: 'IOS_BUILD_NUMBER',
    });
  });

  it('keeps checked-in metadata for local builds without an automated counter', () => {
    const metadata = resolveIosCiVersionMetadata({
      env: {},
      packageVersion: '4.12.2',
      checkedInMarketingVersion: '4.12.3',
      checkedInBuildNumber: '80',
      headTags: [],
    });

    expect(metadata).toEqual({
      marketingVersion: '4.12.3',
      marketingVersionSource: 'checked-in Xcode project',
      buildNumber: '80',
      buildNumberSource: 'checked-in Xcode project',
    });
  });
});

describe('assertMarketingVersionNotBehindPackage', () => {
  it('rejects a checked-in App Store marketing version that lags behind package.json', () => {
    expect(() => assertMarketingVersionNotBehindPackage('4.11.2', '4.12.2')).toThrow(
      'must not be lower than package.json version 4.12.2'
    );
  });

  it('allows an App Store marketing version ahead of package.json for closed train bumps', () => {
    expect(() => assertMarketingVersionNotBehindPackage('4.11.2', '4.11.1')).not.toThrow();
  });
});
