import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPORT_SCRIPT = fileURLToPath(
  new URL('./report-non-mindroom-source-diff.mjs', import.meta.url)
);
const fixtureDirectories = [];

const makeDirectory = (prefix = 'guards-source-report-') => {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  fixtureDirectories.push(directory);
  return directory;
};

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const writeFixture = (repo, path, content) => {
  const destination = join(repo, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);
};

const commit = (repo, message) => {
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
};

const createRepository = (files = {}) => {
  const repo = makeDirectory();
  git(repo, 'init', '-q', '--initial-branch=main');
  git(repo, 'config', 'user.name', 'Source Report Fixture');
  git(repo, 'config', 'user.email', 'source-report@example.invalid');
  writeFixture(
    repo,
    '.github/upstream-source-base.json',
    '{\n  "ref": "refs/tags/upstream-base"\n}\n'
  );
  Object.entries(files).forEach(([path, content]) => writeFixture(repo, path, content));
  const baseline = commit(repo, 'baseline');
  git(repo, 'tag', 'upstream-base', baseline);
  return { repo, baseline };
};

const runReport = (repo, args = [], extraEnv = {}) =>
  spawnSync(process.execPath, [REPORT_SCRIPT, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });

const runJsonReport = (repo, args) => {
  const result = runReport(repo, [...args, '--format', 'json']);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

afterEach(() => {
  fixtureDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true }));
});

test('reports extraction into owned source as one lossless PR increment rename', () => {
  const { repo, baseline } = createRepository({
    'src/app/features/old.ts': 'export const value = 1;\n',
  });
  mkdirSync(join(repo, 'src/app/mindroom'), { recursive: true });
  git(repo, 'mv', 'src/app/features/old.ts', 'src/app/mindroom/new.ts');
  const head = commit(repo, 'extract source');

  const result = runJsonReport(repo, ['--pr-base', baseline, '--head', head]);
  assert.equal(result.increment.changes.length, 1);
  assert.equal(result.increment.changes[0].oldPath, 'src/app/features/old.ts');
  assert.equal(result.increment.changes[0].path, 'src/app/mindroom/new.ts');
  assert.match(result.increment.changes[0].status, /^R/);
  assert.equal(result.upstream.ref, 'refs/tags/upstream-base');
  assert.equal(result.upstream.commit, baseline);
  assert.equal(result.base.commit, baseline);
  assert.equal(result.head.commit, head);
  assert.equal(result.mergeBase, baseline);
});

test('includes ordinary changes and both sides of moves crossing source ownership', () => {
  const { repo, baseline } = createRepository({
    'src/app/features/modify.ts': 'export const value = 1;\n',
    'src/app/features/delete.ts': 'delete me\n',
    'src/app/features/rename.ts': 'rename me\n',
    'src/app/features/outward.ts': 'move to docs\n',
    'src/app/mindroom/inward.ts': 'move out\n',
  });
  writeFixture(repo, 'src/app/features/modify.ts', 'export const value = 2;\n');
  rmSync(join(repo, 'src/app/features/delete.ts'));
  writeFixture(repo, 'src/components/added.tsx', 'export const Added = null;\n');
  writeFixture(repo, 'src/app/mindroom/ignored.ts', 'export const owned = true;\n');
  mkdirSync(join(repo, 'docs'), { recursive: true });
  git(repo, 'mv', 'src/app/features/rename.ts', 'src/app/features/renamed.ts');
  git(repo, 'mv', 'src/app/features/outward.ts', 'docs/outward.ts');
  git(repo, 'mv', 'src/app/mindroom/inward.ts', 'src/app/features/inward.ts');
  const head = commit(repo, 'change source footprint');

  const result = runJsonReport(repo, [baseline, head]);
  const paths = new Set(result.after.changes.map((change) => change.path));
  assert.deepEqual(
    paths,
    new Set([
      'src/app/features/delete.ts',
      'src/app/features/inward.ts',
      'src/app/features/modify.ts',
      'src/app/features/renamed.ts',
      'src/components/added.tsx',
      'docs/outward.ts',
    ])
  );
  const outward = result.after.changes.find((change) => change.path === 'docs/outward.ts');
  assert.equal(outward.oldPath, 'src/app/features/outward.ts');
  const inward = result.after.changes.find(
    (change) => change.path === 'src/app/features/inward.ts'
  );
  assert.equal(inward.oldPath, 'src/app/mindroom/inward.ts');
});

test('preserves odd filenames in JSON and renders all active Markdown syntax literally', () => {
  const { repo, baseline } = createRepository();
  const oddPath =
    'src/app/features/tab\tline\npipe|pair``tick[label](url)*em*_strong_<b>html</b>.ts';
  writeFixture(repo, oddPath, 'export const odd = true;\n');
  const head = commit(repo, 'add odd filename');

  const json = runJsonReport(repo, [baseline, head]);
  assert.equal(json.after.changes[0].path, oddPath);

  const markdown = runReport(repo, [baseline, head, '--format', 'markdown']);
  assert.equal(markdown.status, 0, markdown.stderr);
  assert.match(markdown.stdout, /<code>src\/app\/features\//);
  assert.equal(markdown.stdout.includes('tab\tline\npipe'), false);
  for (const activeSyntax of ['|pair', '``', '[label](url)', '*em*', '_strong_', '<b>html</b>']) {
    assert.equal(markdown.stdout.includes(activeSyntax), false);
  }
  for (const encodedSyntax of [
    '&#124;pair',
    '&#96;&#96;',
    '&#91;label&#93;&#40;url&#41;',
    '&#42;em&#42;',
    '&#95;strong&#95;',
    '&#60;b&#62;html&#60;/b&#62;',
  ]) {
    assert.equal(markdown.stdout.includes(encodedSyntax), true);
  }
});

test('reports empty comparisons without inventing changes', () => {
  const { repo, baseline } = createRepository({
    'src/app/features/stable.ts': 'export const stable = true;\n',
  });

  const result = runJsonReport(repo, [baseline, baseline]);
  assert.equal(result.after.count, 0);
  assert.deepEqual(result.after.changes, []);
  assert.deepEqual(result.after.groups, []);
});

test('fails clearly for malformed options, invalid refs, and a missing configured tag', () => {
  const { repo } = createRepository();
  const malformed = runReport(repo, ['--unknown']);
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.stderr, /Unknown option/);

  const invalid = runReport(repo, ['missing-ref', 'HEAD', '--format', 'json']);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Unable to resolve Git ref/);

  const optionLikeRef = runReport(repo, ['--', '-missing-ref', 'HEAD']);
  assert.notEqual(optionLikeRef.status, 0);
  assert.match(optionLikeRef.stderr, /Unable to resolve Git ref/);

  writeFixture(repo, '.github/upstream-source-base.json', '{"ref":"refs/tags/missing"}\n');
  const missing = runReport(repo, ['--format', 'json']);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /refs\/tags\/missing/);
});

test('uses the PR merge base for divergent branches and the configured tag for both footprints', () => {
  const { repo, baseline } = createRepository({
    'src/app/features/common.ts': 'export const common = true;\n',
  });
  writeFixture(repo, 'src/app/features/base-only.ts', 'export const baseOnly = true;\n');
  const base = commit(repo, 'base branch work');
  git(repo, 'switch', '-q', '-c', 'head-branch', baseline);
  writeFixture(repo, 'src/app/features/head-only.ts', 'export const headOnly = true;\n');
  const head = commit(repo, 'head branch work');

  const result = runJsonReport(repo, ['--pr-base', base, '--head', head]);
  assert.equal(result.mergeBase, baseline);
  assert.deepEqual(
    result.before.changes.map((change) => change.path),
    ['src/app/features/base-only.ts']
  );
  assert.deepEqual(
    result.after.changes.map((change) => change.path),
    ['src/app/features/head-only.ts']
  );
  assert.deepEqual(
    result.increment.changes.map((change) => change.path),
    ['src/app/features/head-only.ts']
  );
});

test('runs from a linked worktree with a relative gitdir pointer', () => {
  const { repo, baseline } = createRepository({
    'src/app/features/stable.ts': 'export const stable = true;\n',
  });
  writeFixture(repo, 'src/app/features/new.ts', 'export const value = true;\n');
  const head = commit(repo, 'add source');
  const linked = makeDirectory('guards-source-worktree-');
  rmSync(linked, { recursive: true });
  git(repo, 'worktree', 'add', '-q', '--detach', linked, head);
  const gitdir = readFileSync(join(linked, '.git'), 'utf8').trim().slice('gitdir: '.length);
  writeFileSync(join(linked, '.git'), 'gitdir: ' + relative(linked, gitdir) + '\n');

  const result = runJsonReport(linked, [baseline, 'HEAD']);
  assert.equal(result.head.commit, head);
  assert.deepEqual(
    result.after.changes.map((change) => change.path),
    ['src/app/features/new.ts']
  );
});

test('fetches a missing configured tag without forcing an inconsistent existing tag', () => {
  const source = createRepository({
    'src/app/features/source.ts': 'export const source = true;\n',
  });
  const consumer = createRepository();
  git(consumer.repo, 'tag', '-d', 'upstream-base');

  const fetched = runReport(consumer.repo, ['--fetch-configured-upstream', source.repo]);
  assert.equal(fetched.status, 0, fetched.stderr);
  assert.equal(
    git(consumer.repo, 'rev-parse', 'refs/tags/upstream-base^{commit}'),
    source.baseline
  );
  const unchanged = runReport(consumer.repo, ['--fetch-configured-upstream', source.repo]);
  assert.equal(unchanged.status, 0, unchanged.stderr);

  git(consumer.repo, 'tag', '-d', 'upstream-base');
  git(consumer.repo, 'tag', 'upstream-base', consumer.baseline);
  const conflict = runReport(consumer.repo, ['--fetch-configured-upstream', source.repo]);
  assert.notEqual(conflict.status, 0);
  assert.match(conflict.stderr, /fetch configured upstream tag/i);
  assert.equal(
    git(consumer.repo, 'rev-parse', 'refs/tags/upstream-base^{commit}'),
    consumer.baseline
  );
});

test('uses the current tracked baseline configuration and validates it as a tag ref', () => {
  const { repo, baseline } = createRepository({
    'src/app/features/old.ts': 'export const old = true;\n',
  });
  writeFixture(repo, 'src/app/features/new.ts', 'export const current = true;\n');
  const secondBase = commit(repo, 'second upstream base');
  git(repo, 'tag', 'second-base', secondBase);
  writeFixture(repo, '.github/upstream-source-base.json', '{"ref":"refs/tags/second-base"}\n');
  const head = commit(repo, 'update baseline configuration');

  const result = runJsonReport(repo, ['--head', head, '--pr-base', baseline]);
  assert.equal(result.upstream.ref, 'refs/tags/second-base');
  assert.equal(result.upstream.commit, secondBase);
  assert.equal(result.after.count, 0);

  writeFixture(repo, '.github/upstream-source-base.json', '{"ref":"refs/heads/main"}\n');
  const invalid = runReport(repo, ['--format', 'json']);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /refs\/tags\//);

  writeFixture(repo, '.github/upstream-source-base.json', '{"ref":"refs/tags/bad..tag"}\n');
  const malformed = runReport(repo, ['--format', 'json']);
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.stderr, /valid Git tag ref/);
});
