import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  APP_STORE_SCREENSHOT_SETS,
  expectedReleaseConfirmation,
  validateReleaseInput,
  validateScreenshotSet,
} from '../../../../scripts/appstore-release-preflight.mjs';

const temporaryDirectories: string[] = [];

const makePngHeader = (width: number, height: number, distinguishingByte: number) => {
  const bytes = Buffer.alloc(25);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = distinguishingByte;
  return bytes;
};

const createScreenshotSet = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mindroom-appstore-release-'));
  temporaryDirectories.push(directory);

  let distinguishingByte = 1;
  for (const device of APP_STORE_SCREENSHOT_SETS) {
    for (const filename of device.filenames) {
      await writeFile(
        join(directory, filename),
        makePngHeader(device.width, device.height, distinguishingByte)
      );
      distinguishingByte += 1;
    }
  }

  return directory;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  );
});

describe('validateReleaseInput', () => {
  it('accepts an exact version, build, release note, and destructive confirmation', () => {
    expect(() =>
      validateReleaseInput({
        appVersion: '4.12.145',
        buildNumber: '141',
        confirmation: expectedReleaseConfirmation('4.12.145', '141'),
        releaseNotes: 'Improves iOS attachment handling.',
      })
    ).not.toThrow();
  });

  it.each([
    ['invalid Apple version', { appVersion: '4.12' }, /three-integer format/],
    ['invalid build number', { buildNumber: '0' }, /positive integer/],
    ['wrong confirmation', { confirmation: 'yes' }, /must exactly equal/],
    ['missing release notes', { releaseNotes: '  ' }, /must not be empty/],
  ])('rejects %s', (_description, override, expectedError) => {
    expect(() =>
      validateReleaseInput({
        appVersion: '4.12.145',
        buildNumber: '141',
        confirmation: expectedReleaseConfirmation('4.12.145', '141'),
        releaseNotes: 'Improves iOS attachment handling.',
        ...override,
      })
    ).toThrow(expectedError);
  });

  it('reports validation failures instead of crashing when called without input', () => {
    expect(() => validateReleaseInput()).toThrowError(/APP_STORE_VERSION/);
  });
});

describe('validateScreenshotSet', () => {
  it('accepts the complete distinct iPhone and iPad release set', async () => {
    const directory = await createScreenshotSet();

    expect(() => validateScreenshotSet(directory)).not.toThrow();
  });

  it('rejects missing, unexpected, wrong-sized, and duplicate screenshots', async () => {
    const directory = await createScreenshotSet();
    const [iphone] = APP_STORE_SCREENSHOT_SETS;
    await rm(join(directory, iphone.filenames[0]));
    await writeFile(join(directory, 'unexpected.png'), makePngHeader(100, 100, 200));
    await writeFile(join(directory, iphone.filenames[1]), makePngHeader(100, 100, 201));
    await writeFile(join(directory, iphone.filenames[3]), makePngHeader(1320, 2868, 3));

    expect(() => validateScreenshotSet(directory)).toThrowError(/Missing screenshots/);
    expect(() => validateScreenshotSet(directory)).toThrowError(/Unexpected screenshots/);
    expect(() => validateScreenshotSet(directory)).toThrowError(/must be 1320 x 2868/);
    expect(() => validateScreenshotSet(directory)).toThrowError(/byte-identical/);
  });
});

describe('Fastlane App Store release contract', () => {
  it('keeps the category in App Store Connect instead of reapplying it as version metadata', () => {
    expect(existsSync(join(process.cwd(), 'ios/App/fastlane/metadata/primary_category.txt'))).toBe(
      false
    );
  });
});
