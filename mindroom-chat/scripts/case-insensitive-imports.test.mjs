import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const MODULE_EXTENSION_RE = /\.(?:[cm]?[jt]sx?)$/;

// Every extensionless path that imports a module: its own, and its folder's for an index module.
const importPaths = (file) => {
  const path = file.replace(MODULE_EXTENSION_RE, '');
  const folder = /^(.+)\/index$/i.exec(path)?.[1];
  return folder === undefined ? [path] : [path, folder];
};

// macOS builds (Xcode Cloud) resolve extensionless imports on a case-insensitive disk, so `./Foo` can
// pick `foo.ts` over `Foo.tsx`, and `./foo` can pick `Foo.tsx` over `foo/index.ts`, while Linux CI resolves both correctly.
const ambiguousImports = (files) => {
  const importsByKey = new Map();
  for (const file of files.filter((name) => MODULE_EXTENSION_RE.test(name))) {
    for (const path of importPaths(file)) {
      const key = path.toLowerCase();
      importsByKey.set(key, [...(importsByKey.get(key) ?? []), { file, path }]);
    }
  }
  return [...importsByKey.values()]
    .filter((imports) => new Set(imports.map(({ path }) => path)).size > 1)
    .map((imports) => imports.map(({ file }) => file));
};

test('flags modules whose import paths differ only by letter case', () => {
  assert.deepEqual(ambiguousImports(['a/Bar.tsx', 'a/bar.ts']), [['a/Bar.tsx', 'a/bar.ts']]);
  assert.deepEqual(ambiguousImports(['a/Dir.tsx', 'a/dir/index.ts']), [
    ['a/Dir.tsx', 'a/dir/index.ts'],
  ]);
  assert.deepEqual(ambiguousImports(['a/dir/index.tsx', 'a/dir/Index.ts']), [
    ['a/dir/index.tsx', 'a/dir/Index.ts'],
  ]);
  assert.deepEqual(ambiguousImports(['a/Dir.tsx', 'a/dir/Index.ts']), [
    ['a/Dir.tsx', 'a/dir/Index.ts'],
  ]);
  assert.deepEqual(
    ambiguousImports(['a/Foo.tsx', 'a/foo.css.ts', 'b/foo.ts', 'b/foo.test.ts', 'b/foo/index.ts']),
    []
  );
});

test('no two modules in src differ only by letter case once the extension is dropped', () => {
  const files = execFileSync('git', ['ls-files', '-z', 'src'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).split('\0');
  assert.deepEqual(ambiguousImports(files), []);
});
