import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APP_LANGUAGE_CODES } from '../../i18nLanguages';

const appDirectory = fileURLToPath(new URL('../../../../ios/App/App/', import.meta.url));
const project = readFileSync(`${appDirectory}../App.xcodeproj/project.pbxproj`, 'utf8');
const nativeCode = (code: string) => {
  if (code === 'zh') return 'zh-Hans';
  if (code === 'zh-TW') return 'zh-Hant';
  return code;
};

const readStrings = (code: string, file: string): Record<string, string> => {
  const source = readFileSync(`${appDirectory}${nativeCode(code)}.lproj/${file}.strings`, 'utf8');
  return Object.fromEntries(
    [...source.matchAll(/("(?:[^"\\]|\\.)*")\s*=\s*("(?:[^"\\]|\\.)*")\s*;/g)].map((match) => [
      JSON.parse(match[1]),
      JSON.parse(match[2]),
    ])
  );
};

describe('native localization resources', () => {
  const notifications = readStrings('en', 'Localizable');
  const permissions = [
    'NSLocalNetworkUsageDescription',
    'NSMicrophoneUsageDescription',
    'NSCameraUsageDescription',
    'NSPhotoLibraryUsageDescription',
    'NSPhotoLibraryAddUsageDescription',
  ];

  APP_LANGUAGE_CODES.forEach((code) => {
    it(`${code} preserves notification arguments and translates every permission prompt`, () => {
      const localized = readStrings(code, 'Localizable');
      expect(Object.keys(localized).sort()).toEqual(Object.keys(notifications).sort());
      Object.entries(notifications).forEach(([key, source]) => {
        expect(localized[key].trim()).not.toBe('');
        const argumentsInMessage = [...localized[key].matchAll(/%\d+\$@/g)];
        expect(argumentsInMessage.map(([token]) => token).sort()).toEqual(
          [...source.matchAll(/%\d+\$@/g)].map(([token]) => token).sort()
        );
        if (code === 'ar') {
          argumentsInMessage.forEach((match) => {
            expect(localized[key][match.index - 1], key).toBe('\u2068');
            expect(localized[key][match.index + match[0].length], key).toBe('\u2069');
          });
        }
      });
      const prompts = readStrings(code, 'InfoPlist');
      expect(Object.keys(prompts).sort()).toEqual([...permissions].sort());
      Object.values(prompts).forEach((value) => expect(value.trim()).not.toBe(''));
    });

    it(`${code} is included in both Xcode resource groups`, () => {
      ['Localizable', 'InfoPlist'].forEach((file) => {
        expect(project).toContain(`path = "${nativeCode(code)}.lproj/${file}.strings";`);
        expect(project).toContain(`/* ${file}.strings in Resources */`);
      });
      const regions = project.match(/knownRegions = \(([\s\S]*?)\);/)?.[1];
      expect(regions).toContain(`"${nativeCode(code)}"`);
    });
  });
});
