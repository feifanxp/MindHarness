import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { copyFiles } from '../../../../vite.config';
import {
  assertElementCallTransparentBackground,
  injectElementCallTransparentBackground,
} from '../../../../scripts/element-call-background.mjs';

const elementCallIndexPath = path.resolve(
  'node_modules/@element-hq/element-call-embedded/dist/index.html'
);

describe('Element Call background build', () => {
  it('copies the real Element Call index through the transparency transform', () => {
    expect(copyFiles.targets).toContainEqual(
      expect.objectContaining({
        src: 'node_modules/@element-hq/element-call-embedded/dist/index.html',
        dest: 'public/element-call',
        transform: injectElementCallTransparentBackground,
      })
    );

    const source = fs.readFileSync(elementCallIndexPath, 'utf8');
    const html = injectElementCallTransparentBackground(source);
    const override = '<style>html,body{background:transparent!important}</style>';

    expect(html).toContain(`<head>${override}`);
    expect(html.indexOf(override)).toBeLessThan(html.indexOf('<link rel="stylesheet"'));
  });

  it('resets the complete Element Call background so its image cannot cover the animation', () => {
    const source = fs.readFileSync(elementCallIndexPath, 'utf8');
    const html = injectElementCallTransparentBackground(source);

    expect(html).toContain('<style>html,body{background:transparent!important}</style>');
    expect(html).not.toContain('html,body{background-color:transparent!important}');
  });

  it('fails the build if an upstream index no longer has the expected head', () => {
    expect(() => injectElementCallTransparentBackground('<html></html>')).toThrow(
      'Element Call index is missing its <head> element'
    );
  });

  it('fails post-build verification if another copy overwrites the transformed index', () => {
    expect(() => assertElementCallTransparentBackground('<html><head></head></html>')).toThrow(
      'Built Element Call index is missing its transparent background override'
    );

    expect(() =>
      assertElementCallTransparentBackground(
        injectElementCallTransparentBackground('<html><head></head></html>')
      )
    ).not.toThrow();
  });

  it('runs the output verification after every production build', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));

    expect(packageJson.scripts.build).toContain('scripts/verify-element-call-background.mjs');
  });
});
