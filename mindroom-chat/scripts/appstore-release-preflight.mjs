#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const PNG_MAGIC_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const SCREENSHOT_SCENES = [
  'light_personal-workspace',
  'dark_mindroom-explained',
  'light_campground-monitor',
  'dark_car-search',
  'light_home-reminders',
];

export const APP_STORE_SCREENSHOT_SETS = [
  {
    device: 'iPhone 6.9-inch',
    slug: 'iphone-6-9',
    width: 1320,
    height: 2868,
  },
  {
    device: 'iPad 13-inch',
    slug: 'ipad-13',
    width: 2064,
    height: 2752,
  },
].map((device) => ({
  ...device,
  filenames: SCREENSHOT_SCENES.map((scene, index) => `${index}_${device.slug}_${scene}.png`),
}));

const failIfAny = (failures) => {
  if (failures.length === 0) return;

  throw new Error(
    `App Store release preflight failed:\n\n${failures.map((failure) => `- ${failure}`).join('\n')}`
  );
};

export function expectedReleaseConfirmation(appVersion, buildNumber) {
  return `submit ${appVersion} (${buildNumber}) for review`;
}

export function validateReleaseInput({
  appVersion = '',
  buildNumber = '',
  confirmation = '',
  releaseNotes = '',
} = {}) {
  const failures = [];
  const expectedConfirmation = expectedReleaseConfirmation(appVersion, buildNumber);

  if (!/^[0-9]+[.][0-9]+[.][0-9]+$/.test(appVersion)) {
    failures.push('APP_STORE_VERSION must use Apple three-integer format such as 4.12.145.');
  }

  if (!/^[1-9][0-9]*$/.test(buildNumber)) {
    failures.push('APP_STORE_BUILD_NUMBER must be a positive integer.');
  }

  if (confirmation !== expectedConfirmation) {
    failures.push(`APP_STORE_RELEASE_CONFIRMATION must exactly equal: ${expectedConfirmation}`);
  }

  if (releaseNotes.trim().length === 0) {
    failures.push('APP_STORE_RELEASE_NOTES must not be empty.');
  } else if (releaseNotes.length > 4_000) {
    failures.push('APP_STORE_RELEASE_NOTES must not exceed 4,000 characters.');
  }

  failIfAny(failures);
}

export function readPngMetadata(filePath) {
  const bytes = fs.readFileSync(filePath);

  if (
    bytes.length < 24 ||
    !bytes.subarray(0, PNG_MAGIC_SIGNATURE.length).equals(PNG_MAGIC_SIGNATURE) ||
    bytes.subarray(12, 16).toString('ascii') !== 'IHDR'
  ) {
    throw new Error(`${path.basename(filePath)} is not a valid PNG with an IHDR header.`);
  }

  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    digest: createHash('sha256').update(bytes).digest('hex'),
  };
}

export function validateScreenshotSet(screenshotDir) {
  const failures = [];

  if (!fs.existsSync(screenshotDir)) {
    throw new Error(`App Store release preflight failed:\n\n- Missing ${screenshotDir}.`);
  }

  const actualFilenames = fs
    .readdirSync(screenshotDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png'))
    .map((entry) => entry.name)
    .sort();
  const expectedFilenames = APP_STORE_SCREENSHOT_SETS.flatMap((device) => device.filenames).sort();
  const missingFilenames = expectedFilenames.filter(
    (filename) => !actualFilenames.includes(filename)
  );
  const unexpectedFilenames = actualFilenames.filter(
    (filename) => !expectedFilenames.includes(filename)
  );

  if (missingFilenames.length > 0) {
    failures.push(`Missing screenshots: ${missingFilenames.join(', ')}.`);
  }
  if (unexpectedFilenames.length > 0) {
    failures.push(`Unexpected screenshots: ${unexpectedFilenames.join(', ')}.`);
  }

  APP_STORE_SCREENSHOT_SETS.forEach((device) => {
    const digests = new Map();
    device.filenames.forEach((filename) => {
      const filePath = path.join(screenshotDir, filename);
      if (!fs.existsSync(filePath)) return;

      try {
        const metadata = readPngMetadata(filePath);
        if (metadata.width !== device.width || metadata.height !== device.height) {
          failures.push(
            `${filename} must be ${device.width} x ${device.height}, got ${metadata.width} x ${metadata.height}.`
          );
        }

        const duplicateOf = digests.get(metadata.digest);
        if (duplicateOf) {
          failures.push(`${filename} is byte-identical to ${duplicateOf}.`);
        } else {
          digests.set(metadata.digest, filename);
        }
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    });
  });

  failIfAny(failures);
}

export function runReleasePreflight({ env = process.env } = {}) {
  const appVersion = env.APP_STORE_VERSION?.trim() ?? '';
  const buildNumber = env.APP_STORE_BUILD_NUMBER?.trim() ?? '';
  const confirmation = env.APP_STORE_RELEASE_CONFIRMATION?.trim() ?? '';
  const releaseNotes = env.APP_STORE_RELEASE_NOTES?.trim() ?? '';
  const screenshotDir = path.resolve(
    env.APP_STORE_SCREENSHOT_DIR ??
      path.join(repoRoot, 'ios', 'App', 'fastlane', 'screenshots', 'en-US')
  );

  validateReleaseInput({ appVersion, buildNumber, confirmation, releaseNotes });
  validateScreenshotSet(screenshotDir);
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  try {
    runReleasePreflight();
    console.log('App Store release preflight passed.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
