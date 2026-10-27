#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertMarketingVersionNotBehindPackage } from './ios-ci-version.mjs';
import { getAppTargetBuildSettingValues } from './ios-xcode-project.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const configFileName = 'config.mindroom.json';
const configPath = path.join(repoRoot, configFileName);
const packagePath = path.join(repoRoot, 'package.json');
const capacitorConfigPath = path.join(repoRoot, 'capacitor.config.ts');
const xcodeProjectPath = path.join(repoRoot, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
const infoPlistPath = path.join(repoRoot, 'ios', 'App', 'App', 'Info.plist');
const entitlementsPath = path.join(repoRoot, 'ios', 'App', 'App', 'App.entitlements');
const appDelegatePath = path.join(repoRoot, 'ios', 'App', 'App', 'AppDelegate.swift');
const localizableStringsPath = path.join(
  repoRoot,
  'ios',
  'App',
  'App',
  'en.lproj',
  'Localizable.strings'
);
const appIconDir = path.join(
  repoRoot,
  'ios',
  'App',
  'App',
  'Assets.xcassets',
  'AppIcon.appiconset'
);
const appIconContentsPath = path.join(appIconDir, 'Contents.json');

const failures = [];

const readText = (filePath) => fs.readFileSync(filePath, 'utf8');

const readStringsText = (filePath) => {
  const contents = fs.readFileSync(filePath);
  if (contents[0] === 0xff && contents[1] === 0xfe) {
    return contents.subarray(2).toString('utf16le');
  }
  if (contents[0] === 0xfe && contents[1] === 0xff) {
    const littleEndianContents = Buffer.from(contents.subarray(2));
    littleEndianContents.swap16();
    return littleEndianContents.toString('utf16le');
  }
  return contents.toString('utf8');
};

const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const config = JSON.parse(readText(configPath));
const packageJson = JSON.parse(readText(packagePath));
const capacitorConfig = readText(capacitorConfigPath);
const xcodeProject = readText(xcodeProjectPath);
const infoPlist = readText(infoPlistPath);
const entitlements = fs.existsSync(entitlementsPath) ? readText(entitlementsPath) : '';
const appDelegate = readText(appDelegatePath);
const appIconContents = JSON.parse(readText(appIconContentsPath));

const authConfig = config.auth ?? {};
const iosPushConfig = config.push?.ios ?? {};
const isHttpsUrl = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) return false;

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
};
const capacitorAppIdMatch = capacitorConfig.match(/appId:\s*['"]([^'"]+)['"]/);
const hasPlistKey = (plist, key) =>
  new RegExp(`<key>\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*</key>`).test(plist);
const hasSingleValue = (values) => new Set(values).size === 1;

let marketingVersions = [];
let buildNumbers = [];
let bundleIdentifiers = [];

try {
  marketingVersions = getAppTargetBuildSettingValues(xcodeProject, 'MARKETING_VERSION').map(
    (record) => record.value
  );
  buildNumbers = getAppTargetBuildSettingValues(xcodeProject, 'CURRENT_PROJECT_VERSION').map(
    (record) => record.value
  );
  bundleIdentifiers = getAppTargetBuildSettingValues(xcodeProject, 'PRODUCT_BUNDLE_IDENTIFIER').map(
    (record) => record.value
  );
} catch (error) {
  check(false, `Xcode project: ${error.message}`);
}

check(
  authConfig.allowRegistration === true,
  `${configFileName}: auth.allowRegistration must be true.`
);
check(
  authConfig.requireAppleProvider === true,
  `${configFileName}: auth.requireAppleProvider must be true.`
);
check(
  isHttpsUrl(authConfig.supportUrl),
  `${configFileName}: auth.supportUrl must be a public HTTPS URL.`
);
check(
  isHttpsUrl(authConfig.privacyPolicyUrl),
  `${configFileName}: auth.privacyPolicyUrl must be a public HTTPS URL.`
);
check(
  isHttpsUrl(authConfig.termsUrl),
  `${configFileName}: auth.termsUrl must be a public HTTPS URL.`
);

check(marketingVersions.length > 0, 'Xcode project: missing App target MARKETING_VERSION entries.');
check(
  marketingVersions.every((value) => /^[0-9]+[.][0-9]+[.][0-9]+$/.test(value)),
  'Xcode project: MARKETING_VERSION must use Apple three-integer format such as 4.11.2.'
);
check(
  hasSingleValue(marketingVersions),
  'Xcode project: App target MARKETING_VERSION values must match across build configurations.'
);
marketingVersions.forEach((marketingVersion) => {
  try {
    assertMarketingVersionNotBehindPackage(marketingVersion, packageJson.version);
  } catch (error) {
    check(false, `Xcode project: ${error.message}`);
  }
});
check(
  buildNumbers.length > 0,
  'Xcode project: missing App target CURRENT_PROJECT_VERSION entries.'
);
check(
  buildNumbers.every((value) => /^[0-9]+$/.test(value)),
  'Xcode project: CURRENT_PROJECT_VERSION must be an integer App Store build number.'
);
check(
  hasSingleValue(buildNumbers),
  'Xcode project: App target CURRENT_PROJECT_VERSION values must match across build configurations.'
);
check(
  bundleIdentifiers.length > 0,
  'Xcode project: missing App target PRODUCT_BUNDLE_IDENTIFIER entries.'
);
check(
  hasSingleValue(bundleIdentifiers),
  'Xcode project: App target PRODUCT_BUNDLE_IDENTIFIER values must match across build configurations.'
);
check(
  xcodeProject.includes('com.apple.SignInWithApple'),
  'Xcode project: missing Sign in with Apple capability.'
);
check(
  hasPlistKey(entitlements, 'com.apple.developer.applesignin'),
  'App.entitlements: missing Sign in with Apple entitlement.'
);

if (iosPushConfig.enabled === true) {
  check(
    typeof iosPushConfig.appId === 'string' && iosPushConfig.appId.trim().length > 0,
    `${configFileName}: push.ios.appId must be set when push.ios.enabled is true.`
  );
  check(
    isHttpsUrl(iosPushConfig.gatewayUrl),
    `${configFileName}: push.ios.gatewayUrl must be a HTTPS URL when push.ios.enabled is true.`
  );
  check(
    capacitorAppIdMatch?.[1] === iosPushConfig.appId,
    `capacitor.config.ts: appId must match ${configFileName} push.ios.appId when iOS push is enabled.`
  );
  check(
    bundleIdentifiers.length > 0 &&
      bundleIdentifiers.every((value) => value === iosPushConfig.appId),
    `Xcode project: PRODUCT_BUNDLE_IDENTIFIER must match ${configFileName} push.ios.appId when iOS push is enabled.`
  );
  check(
    fs.existsSync(entitlementsPath),
    'iOS: App.entitlements must exist when push.ios.enabled is true.'
  );
  if (fs.existsSync(entitlementsPath)) {
    check(
      hasPlistKey(entitlements, 'aps-environment'),
      'App.entitlements: missing aps-environment key.'
    );
  }
  check(
    appDelegate.includes('didRegisterForRemoteNotificationsWithDeviceToken'),
    'AppDelegate.swift: missing APNs didRegisterForRemoteNotifications callback.'
  );
  check(
    appDelegate.includes('didFailToRegisterForRemoteNotificationsWithError'),
    'AppDelegate.swift: missing APNs didFailToRegisterForRemoteNotifications callback.'
  );

  if (iosPushConfig.format === 'full') {
    check(
      fs.existsSync(localizableStringsPath),
      'iOS: full push payloads require en.lproj/Localizable.strings.'
    );
    check(
      xcodeProject.includes('Localizable.strings in Resources'),
      'Xcode project: Localizable.strings must be included in the App resources phase.'
    );

    if (fs.existsSync(localizableStringsPath)) {
      const localizableStrings = readStringsText(localizableStringsPath);
      const requiredSygnalLocalizations = {
        MSG_FROM_USER_WITH_CONTENT: '%1$@: %2$@',
        MSG_FROM_USER_IN_ROOM_WITH_CONTENT: '%1$@ in %2$@: %3$@',
        MSG_FROM_USER: 'Message from %1$@',
        MSG_FROM_USER_IN_ROOM: '%1$@ in %2$@',
        ACTION_FROM_USER: '%1$@ %2$@',
        ACTION_FROM_USER_IN_ROOM: '%2$@ %3$@ in %1$@',
        IMAGE_FROM_USER: '%1$@ sent an image: %2$@',
        IMAGE_FROM_USER_IN_ROOM: '%1$@ sent an image in %3$@: %2$@',
        VOICE_CALL_FROM_USER: 'Voice call from %1$@',
        VIDEO_CALL_FROM_USER: 'Video call from %1$@',
        USER_INVITE_TO_NAMED_ROOM: '%1$@ invited you to %2$@',
        USER_INVITE_TO_CHAT: '%1$@ invited you to a chat',
      };

      Object.entries(requiredSygnalLocalizations).forEach(([key, value]) => {
        check(
          localizableStrings.includes(`"${key}" = "${value}";`),
          `Localizable.strings: missing or invalid Sygnal notification template ${key}.`
        );
      });
    }
  }
}

const requiredPlistKeys = [
  'ITSAppUsesNonExemptEncryption',
  'NSAppTransportSecurity',
  'NSAllowsLocalNetworking',
  'NSLocalNetworkUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSCameraUsageDescription',
  'NSPhotoLibraryUsageDescription',
  'NSPhotoLibraryAddUsageDescription',
];

requiredPlistKeys.forEach((key) => {
  check(infoPlist.includes(`<key>${key}</key>`), `Info.plist: missing key ${key}.`);
});

check(
  !infoPlist.includes('<key>NSAllowsArbitraryLoads</key>'),
  'Info.plist: NSAllowsArbitraryLoads should not be present.'
);

check(
  infoPlist.includes('<string>arm64</string>'),
  'Info.plist: arm64 device capability should be declared.'
);

const iconImages = Array.isArray(appIconContents.images) ? appIconContents.images : [];
check(iconImages.length > 0, 'AppIcon Contents.json: images array is empty.');

const requiredIconFilenames = [
  'AppIcon-1024.png',
  'Icon-App-20x20@2x.png',
  'Icon-App-20x20@3x.png',
  'Icon-App-29x29@2x.png',
  'Icon-App-29x29@3x.png',
  'Icon-App-40x40@2x.png',
  'Icon-App-40x40@3x.png',
  'Icon-App-60x60@2x.png',
  'Icon-App-60x60@3x.png',
  'Icon-App-20x20@1x~ipad.png',
  'Icon-App-20x20@2x~ipad.png',
  'Icon-App-29x29@1x~ipad.png',
  'Icon-App-29x29@2x~ipad.png',
  'Icon-App-40x40@1x~ipad.png',
  'Icon-App-40x40@2x~ipad.png',
  'Icon-App-76x76@1x~ipad.png',
  'Icon-App-76x76@2x~ipad.png',
  'Icon-App-83.5x83.5@2x~ipad.png',
];

const iconFilenameSet = new Set(
  iconImages
    .map((image) => (typeof image?.filename === 'string' ? image.filename : ''))
    .filter(Boolean)
);

requiredIconFilenames.forEach((filename) => {
  check(
    iconFilenameSet.has(filename),
    `AppIcon Contents.json: missing icon slot filename ${filename}.`
  );
  check(fs.existsSync(path.join(appIconDir, filename)), `AppIcon asset missing file ${filename}.`);
});

check(
  iconImages.some(
    (image) => image?.idiom === 'ios-marketing' && image?.filename === 'AppIcon-1024.png'
  ),
  'AppIcon Contents.json: missing ios-marketing 1024 icon entry.'
);

if (failures.length > 0) {
  console.error('App Store preflight failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('App Store preflight passed.');
