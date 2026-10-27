import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const DIRECT_CLIPBOARD_PATTERNS = [
  'navigator.clipboard',
  'document.execCommand',
  'Clipboard.write',
];

const listSourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    if (!SOURCE_EXTENSIONS.has(extname(entry.name))) return [];
    if (/\.(?:test|spec)\.[jt]sx?$/.test(entry.name)) return [];
    return [path];
  });

describe('clipboard ownership', () => {
  it('keeps native, browser, and legacy clipboard APIs behind the shared helper', () => {
    const offenders = listSourceFiles(APP_ROOT)
      .filter((path) => relative(APP_ROOT, path) !== 'utils/dom.ts')
      .flatMap((path) => {
        const source = readFileSync(path, 'utf8');
        return DIRECT_CLIPBOARD_PATTERNS.filter((pattern) => source.includes(pattern)).map(
          (pattern) => `${relative(APP_ROOT, path)}: ${pattern}`
        );
      });

    expect(offenders).toEqual([]);
  });
});
