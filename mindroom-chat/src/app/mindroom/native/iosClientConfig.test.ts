import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { iosClientConfig } from '../../../../scripts/ios-client-config.mjs';
import { resolveComputerApiUrl } from '../computer/api';

const source = readFileSync(new URL('../../../../config.mindroom.json', import.meta.url), 'utf8');
const settings = JSON.parse(
  readFileSync(new URL('../../../../config.mindroom.ios.json', import.meta.url), 'utf8')
);

describe('bundled iOS client config', () => {
  it('enables canvases and libraries in iOS and keeps computers opt-in until deployment', () => {
    const base = JSON.parse(source);
    const ios = JSON.parse(iosClientConfig(source, settings));
    expect(base.mindroom.canvas).toEqual({ enabled: false, libraries: false });
    expect(base.mindroom.computers.apiUrl).toBe('');
    expect(ios.mindroom.canvas).toEqual({ enabled: true, libraries: true });
    expect(ios.mindroom.computers.apiUrl).toBe('');
    expect(resolveComputerApiUrl(ios.mindroom.computers.apiUrl)).toBeUndefined();
    expect({
      ...ios,
      mindroom: { ...ios.mindroom, canvas: undefined, computers: undefined },
    }).toEqual({
      ...base,
      mindroom: { ...base.mindroom, canvas: undefined, computers: undefined },
    });
  });

  it('lets operators select or disable the computer service without modifying shared config', () => {
    const custom = JSON.parse(iosClientConfig(source, settings, 'https://computer.example.org'));
    expect(resolveComputerApiUrl(custom.mindroom.computers.apiUrl)).toBe(
      'https://computer.example.org'
    );
    expect(JSON.parse(iosClientConfig(source, settings, '')).mindroom.computers.apiUrl).toBe('');
  });

  it('uses the iOS build in Xcode Cloud and phone builds', () => {
    const script = readFileSync(
      new URL('../../../../ios/App/ci_scripts/ci_pre_xcodebuild.sh', import.meta.url),
      'utf8'
    );
    const phone = readFileSync(
      new URL('../../../../scripts/ios-phone.mjs', import.meta.url),
      'utf8'
    );
    const fastlane = readFileSync(
      new URL('../../../../ios/App/fastlane/Fastfile', import.meta.url),
      'utf8'
    );
    expect(script).toContain('npm run build:ios');
    expect(fastlane).toContain('npm run build:ios && npx cap sync ios');
    expect(fastlane).not.toContain('npm run build && npx cap sync ios');
    expect(phone).toContain("await run('npm', ['run', 'build:ios'])");
  });
});
