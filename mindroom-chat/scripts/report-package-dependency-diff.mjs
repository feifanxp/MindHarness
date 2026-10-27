#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const workTree = process.cwd();
const gitFile = resolve(workTree, '.git');
const env = { ...process.env };

if (existsSync(gitFile) && statSync(gitFile).isFile()) {
  const gitFileBody = readFileSync(gitFile, 'utf8').trim();
  const gitdirPrefix = 'gitdir: ';
  if (gitFileBody.startsWith(gitdirPrefix)) {
    env.GIT_DIR = gitFileBody.slice(gitdirPrefix.length);
    env.GIT_WORK_TREE = workTree;
  }
}

const [base = 'v4.11.1', target = 'HEAD'] = process.argv.slice(2);

const forkOwnedPackages = new Map(
  [
    [
      'MindRoom product/runtime',
      [
        '@basnijholt/particular-drift',
        '@dnd-kit/core',
        '@dnd-kit/sortable',
        '@dnd-kit/utilities',
        '@tabler/icons-react',
        '@tanstack/react-virtual',
        'fuse.js',
        'idb',
        'katex',
        'workbox-precaching',
        'workbox-routing',
      ],
    ],
    [
      'Native mobile',
      [
        '@capacitor/android',
        '@capacitor/app',
        '@capacitor/app-launcher',
        '@capacitor/browser',
        '@capacitor/cli',
        '@capacitor/clipboard',
        '@capacitor/core',
        '@capacitor/haptics',
        '@capacitor/ios',
        '@capacitor/keyboard',
        '@capacitor/push-notifications',
        '@capacitor/splash-screen',
        '@capacitor/status-bar',
      ],
    ],
    [
      'Test/tooling',
      [
        '@playwright/test',
        '@types/react-test-renderer',
        '@typescript-eslint/eslint-plugin',
        '@typescript-eslint/parser',
        'eslint',
        'fake-indexeddb',
        'jsdom',
        'patch-package',
        'react-test-renderer',
        'typescript',
        'vitest',
      ],
    ],
  ].flatMap(([label, packages]) => packages.map((name) => [name, label]))
);

const upstreamAdoptionPackages = new Set([
  '@element-hq/element-call-embedded',
  '@types/sanitize-html',
  'cz-conventional-changelog',
  'husky',
  'lint-staged',
  'matrix-js-sdk',
  'matrix-widget-api',
  'sanitize-html',
]);

const showFile = (ref, path) =>
  execFileSync('git', ['show', `${ref}:${path}`], {
    cwd: workTree,
    env,
    encoding: 'utf8',
  });

const readPackageJson = (ref) => JSON.parse(showFile(ref, 'package.json'));

const diffNameStatus = (pathspec) =>
  execFileSync(
    'git',
    ['diff', '--name-status', '--find-renames', `${base}..${target}`, '--', pathspec],
    {
      cwd: workTree,
      env,
      encoding: 'utf8',
    }
  )
    .trim()
    .split('\n')
    .filter(Boolean);

const basePackage = readPackageJson(base);
const targetPackage = readPackageJson(target);

const compareRecord = (baseRecord = {}, targetRecord = {}) => {
  const names = new Set([...Object.keys(baseRecord), ...Object.keys(targetRecord)]);

  return [...names].sort().flatMap((name) => {
    const from = baseRecord[name];
    const to = targetRecord[name];
    if (from === to) return [];
    if (from === undefined) return [{ name, from: '-', to, change: 'added' }];
    if (to === undefined) return [{ name, from, to: '-', change: 'removed' }];
    return [{ name, from, to, change: 'changed' }];
  });
};

const classifyPackage = (name) => {
  if (forkOwnedPackages.has(name)) return forkOwnedPackages.get(name);
  if (upstreamAdoptionPackages.has(name)) return 'Upstream adoption/rebase';
  return 'Unclassified';
};

const dependencyChanges = [
  ...compareRecord(basePackage.dependencies, targetPackage.dependencies).map((row) => ({
    ...row,
    section: 'dependencies',
  })),
  ...compareRecord(basePackage.devDependencies, targetPackage.devDependencies).map((row) => ({
    ...row,
    section: 'devDependencies',
  })),
];

const scriptChanges = compareRecord(basePackage.scripts, targetPackage.scripts);
const lockRoot = JSON.parse(showFile(target, 'package-lock.json')).packages?.[''] ?? {};
const lockRootDeps = {
  ...(lockRoot.dependencies ?? {}),
  ...(lockRoot.devDependencies ?? {}),
};

const printRows = (rows, format) => {
  if (rows.length === 0) {
    console.log('  none');
    return;
  }

  for (const row of rows) console.log(`  ${format(row)}`);
};

console.log(`Package dependency diff in ${base}..${target}`);
console.log('');

console.log('Direct package changes:');
printRows(
  dependencyChanges,
  ({ section, name, from, to, change }) =>
    `${section} ${change}: ${name} ${from} -> ${to} [${classifyPackage(name)}]`
);

console.log('');
console.log('Script changes:');
printRows(scriptChanges, ({ name, from, to, change }) => `${change}: ${name} ${from} -> ${to}`);

console.log('');
console.log('Patch files:');
printRows(diffNameStatus('patches'), (line) => line);

const missingFromLockRoot = dependencyChanges
  .filter(({ change }) => change !== 'removed')
  .filter(({ name, to }) => lockRootDeps[name] !== to);

console.log('');
console.log('Target lockfile root manifest check:');
if (missingFromLockRoot.length === 0) {
  console.log('  package-lock.json root dependency entries match package.json');
} else {
  printRows(
    missingFromLockRoot,
    ({ name, to }) => `${name} expected ${to}, package-lock root has ${lockRootDeps[name] ?? '-'}`
  );
}

const unclassified = dependencyChanges.filter(
  ({ name }) => classifyPackage(name) === 'Unclassified'
);
if (unclassified.length > 0) {
  console.log('');
  console.log(
    'Unclassified package changes need an ownership decision before clean-history staging.'
  );
  process.exitCode = 1;
}
