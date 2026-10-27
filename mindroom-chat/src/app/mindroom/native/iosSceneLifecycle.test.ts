import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
// Use the same parsers as the declared Capacitor CLI dependency.
const requireCapacitor = createRequire(require.resolve('@capacitor/cli/package.json'));
const plist = requireCapacitor('plist');
const xcode = requireCapacitor('xcode');
const appDirectory = resolve('ios/App/App');
const info = plist.parse(readFileSync(resolve(appDirectory, 'Info.plist'), 'utf8'));

describe('iOS scene launch configuration', () => {
  it('provides a single application scene for SDKs that require scene lifecycle adoption', () => {
    const manifest = info.UIApplicationSceneManifest;
    expect(manifest, 'iOS 27 rejects legacy application-only startup').toBeDefined();
    expect(manifest.UIApplicationSupportsMultipleScenes).toBe(false);
    const scenes = manifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication;
    expect(scenes).toHaveLength(1);
    expect(scenes[0].UISceneConfigurationName).toBeTruthy();
    // This app creates its custom bridge in the scene delegate, so UIKit must
    // not create a second bridge from the old application or scene storyboard.
    expect(info.UIMainStoryboardFile).toBeUndefined();
    expect(scenes[0].UISceneStoryboardFile).toBeUndefined();
  });

  it('compiles the scene delegate referenced by the launch manifest into the App target', () => {
    const scenes =
      info.UIApplicationSceneManifest?.UISceneConfigurations?.UIWindowSceneSessionRoleApplication;
    const delegateName = scenes?.[0]?.UISceneDelegateClassName;
    expect(delegateName).toMatch(/^\$\(PRODUCT_MODULE_NAME\)\.[A-Za-z]+$/);
    const fileName = `${delegateName.split('.').at(-1)}.swift`;
    expect(existsSync(resolve(appDirectory, fileName))).toBe(true);

    const project = xcode.project(resolve('ios/App/App.xcodeproj/project.pbxproj'));
    project.parseSync();
    const target = project.getFirstTarget();
    const phase = project.pbxSourcesBuildPhaseObj(target.uuid);
    const buildFiles = project.pbxBuildFileSection();
    const fileReferences = project.pbxFileReferenceSection();
    const compiledPaths = phase.files.map(({ value }: { value: string }) => {
      const reference = fileReferences[buildFiles[value].fileRef];
      return reference.path.replace(/^"|"$/g, '');
    });
    expect(compiledPaths).toContain(fileName);
    expect(compiledPaths).toContain('MindRoomBridgeViewController.swift');
  });
});
