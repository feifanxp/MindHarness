#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const workTree = process.cwd();
const gitFile = resolve(workTree, '.git');
const configPath = resolve(workTree, '.github/upstream-source-base.json');
const env = { ...process.env };

if (existsSync(gitFile) && statSync(gitFile).isFile()) {
  const gitFileBody = readFileSync(gitFile, 'utf8').trim();
  const gitdirPrefix = 'gitdir: ';
  if (gitFileBody.startsWith(gitdirPrefix)) {
    env.GIT_DIR = resolve(dirname(gitFile), gitFileBody.slice(gitdirPrefix.length));
    env.GIT_WORK_TREE = workTree;
  }
}

const usage = `Usage:
  node scripts/report-non-mindroom-source-diff.mjs [base [target]] [--format text|json|markdown]
  node scripts/report-non-mindroom-source-diff.mjs --pr-base BASE --head HEAD --format text|json|markdown
  node scripts/report-non-mindroom-source-diff.mjs --fetch-configured-upstream URL`;

const git = (args, options = {}) =>
  execFileSync('git', args, {
    cwd: workTree,
    env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });

const readConfiguredUpstream = () => {
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error('Unable to read .github/upstream-source-base.json: ' + error.message);
  }
  if (typeof config.ref !== 'string' || !config.ref.startsWith('refs/tags/')) {
    throw new Error('Configured upstream ref must begin with refs/tags/.');
  }
  try {
    git(['check-ref-format', config.ref]);
  } catch {
    throw new Error('Configured upstream ref is not a valid Git tag ref: ' + config.ref);
  }
  return config.ref;
};

const resolveCommit = (ref) => {
  try {
    return git(['rev-parse', '--verify', '--end-of-options', ref + '^{commit}']).trim();
  } catch {
    throw new Error('Unable to resolve Git ref "' + ref + '" to a commit.');
  }
};

const parseArguments = (args) => {
  const parsed = { format: 'text', positionals: [] };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--') {
      parsed.positionals.push(...args.slice(index + 1));
      break;
    }
    if (value === '--format' || value === '--pr-base' || value === '--head') {
      const next = args[index + 1];
      if (next === undefined) throw new Error('Missing value for ' + value + '.');
      parsed[value.slice(2).replace('-', '')] = next;
      index += 1;
      continue;
    }
    if (value === '--fetch-configured-upstream') {
      const next = args[index + 1];
      if (next === undefined) throw new Error('Missing value for ' + value + '.');
      parsed.fetchConfiguredUpstream = next;
      index += 1;
      continue;
    }
    if (value.startsWith('-')) throw new Error('Unknown option: ' + value + '.');
    parsed.positionals.push(value);
  }
  if (!['text', 'json', 'markdown'].includes(parsed.format)) {
    throw new Error('Unsupported format: ' + parsed.format + '.');
  }
  if (parsed.positionals.length > 2) throw new Error('Too many positional arguments.');
  const prMode = parsed.prbase !== undefined || parsed.head !== undefined;
  if (prMode && (parsed.prbase === undefined || parsed.head === undefined)) {
    throw new Error('--pr-base and --head must be supplied together.');
  }
  if (prMode && parsed.positionals.length > 0) {
    throw new Error('Positional refs cannot be combined with --pr-base and --head.');
  }
  if (
    parsed.fetchConfiguredUpstream &&
    (prMode || parsed.positionals.length > 0 || parsed.format !== 'text')
  ) {
    throw new Error('--fetch-configured-upstream must be used by itself.');
  }
  return { ...parsed, prMode };
};

const isUpstreamSourcePath = (path) =>
  path.startsWith('src/') && !path.startsWith('src/app/mindroom/');

const parseNameStatus = (output) => {
  const fields = output.split('\0');
  if (fields.at(-1) === '') fields.pop();
  const changes = [];
  for (let index = 0; index < fields.length; ) {
    const status = fields[index];
    index += 1;
    if (!status) throw new Error('Git emitted an empty name-status record.');
    if (status.startsWith('R') || status.startsWith('C')) {
      const oldPath = fields[index];
      const path = fields[index + 1];
      index += 2;
      if (oldPath === undefined || path === undefined) {
        throw new Error('Git emitted an incomplete rename/copy record.');
      }
      changes.push({ status, path, oldPath });
      continue;
    }
    const path = fields[index];
    index += 1;
    if (path === undefined) throw new Error('Git emitted an incomplete name-status record.');
    changes.push({ status, path });
  }
  return changes;
};

const groupForPath = (path) => {
  const parts = path.split('/');
  return parts[1] === 'app' ? 'src/app/' + (parts[2] ?? '') : 'src/' + (parts[1] ?? '');
};

const compare = (base, head) => {
  const rows = git(['diff', '--name-status', '-z', '--find-renames', base, head]);
  const changes = parseNameStatus(rows).filter(
    ({ path, oldPath }) => isUpstreamSourcePath(path) || (oldPath && isUpstreamSourcePath(oldPath))
  );
  const groupCounts = new Map();
  changes.forEach(({ path, oldPath }) => {
    const sourcePath = isUpstreamSourcePath(path) ? path : oldPath;
    const group = groupForPath(sourcePath);
    groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
  });
  const groups = [...groupCounts]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
  return { base, head, count: changes.length, groups, changes };
};

const escapeTextPath = (path) => JSON.stringify(path);
const escapeMarkdownCell = (value) => {
  const display = JSON.stringify(value).slice(1, -1);
  const encoded = Array.from(display, (character) =>
    /[A-Za-z0-9 ./-]/.test(character) ? character : '&#' + character.codePointAt(0) + ';'
  ).join('');
  return '<code>' + encoded + '</code>';
};

const formatChangesText = (comparison) => {
  const lines = comparison.groups.map(
    ({ name, count }) => String(count).padStart(4, ' ') + ' ' + name
  );
  if (comparison.changes.length > 0) lines.push('');
  comparison.changes.forEach(({ status, path, oldPath }) => {
    lines.push(
      oldPath
        ? status + '\t' + escapeTextPath(oldPath) + '\t' + escapeTextPath(path)
        : status + '\t' + escapeTextPath(path)
    );
  });
  return lines;
};

const formatText = (report) => {
  if (report.mode === 'comparison') {
    return [
      'Non-MindRoom source files changed in ' +
        report.upstream.ref +
        '..' +
        report.head.ref +
        ': ' +
        report.after.count,
      'Resolved base: ' + report.upstream.commit,
      'Resolved head: ' + report.head.commit,
      ...formatChangesText(report.after),
    ].join('\n');
  }
  return [
    'Non-MindRoom source footprint against ' + report.upstream.ref,
    'Resolved upstream: ' + report.upstream.commit,
    'Resolved PR base: ' + report.base.commit,
    'Resolved PR head: ' + report.head.commit,
    'Resolved PR merge base: ' + report.mergeBase,
    'Before footprint: ' + report.before.count,
    'After footprint: ' + report.after.count,
    'Footprint delta: ' + (report.after.count - report.before.count),
    'PR increment: ' + report.increment.count,
    '',
    'PR increment changes:',
    ...formatChangesText(report.increment),
  ].join('\n');
};

const markdownChanges = (comparison) => {
  if (comparison.changes.length === 0) return ['No affected upstream-owned source paths.'];
  return [
    '| Status | Previous path | Current path |',
    '| --- | --- | --- |',
    ...comparison.changes.map(
      ({ status, path, oldPath }) =>
        '| ' +
        escapeMarkdownCell(status) +
        ' | ' +
        (oldPath ? escapeMarkdownCell(oldPath) : '') +
        ' | ' +
        escapeMarkdownCell(path) +
        ' |'
    ),
  ];
};

const formatMarkdown = (report) => {
  const lines = [
    '## Upstream source footprint',
    '',
    '- Configured upstream: `' + report.upstream.ref + '` (`' + report.upstream.commit + '`)',
    '- Compared base: `' + report.base.ref + '` (`' + report.base.commit + '`)',
    '- Compared head: `' + report.head.ref + '` (`' + report.head.commit + '`)',
    '- Merge base: `' + report.mergeBase + '`',
    '',
    '| Comparison | Changed upstream-owned source paths |',
    '| --- | ---: |',
    '| Upstream to PR base | ' + report.before.count + ' |',
    '| Upstream to PR head | ' + report.after.count + ' |',
    '| PR increment from merge base | ' + report.increment.count + ' |',
    '| Footprint delta | ' + (report.after.count - report.before.count) + ' |',
    '',
    '### PR increment paths',
    '',
    ...markdownChanges(report.increment),
  ];
  if (report.mode === 'comparison') {
    lines.splice(
      8,
      4,
      '| Requested comparison | ' + report.after.count + ' |',
      '| Increment from merge base | ' + report.increment.count + ' |'
    );
  }
  return lines.join('\n');
};

const fetchConfiguredUpstream = (remote) => {
  const ref = readConfiguredUpstream();
  try {
    git(['fetch', '--no-tags', remote, ref + ':' + ref], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    throw new Error('Unable to fetch configured upstream tag without forcing an update: ' + ref);
  }
  return ref;
};

const buildReport = (options) => {
  const configuredRef = readConfiguredUpstream();
  const upstreamRef = options.prMode ? configuredRef : options.positionals[0] ?? configuredRef;
  const baseRef = options.prMode ? options.prbase : upstreamRef;
  const headRef = options.prMode ? options.head : options.positionals[1] ?? 'HEAD';
  const upstreamCommit = resolveCommit(upstreamRef);
  const baseCommit = resolveCommit(baseRef);
  const headCommit = resolveCommit(headRef);
  const mergeBase = git(['merge-base', baseCommit, headCommit]).trim();
  if (!mergeBase) throw new Error('Unable to find a merge base for supplied refs.');
  return {
    mode: options.prMode ? 'pull-request' : 'comparison',
    upstream: { ref: upstreamRef, commit: upstreamCommit },
    base: { ref: baseRef, commit: baseCommit },
    head: { ref: headRef, commit: headCommit },
    mergeBase,
    before: compare(upstreamCommit, baseCommit),
    after: compare(upstreamCommit, headCommit),
    increment: compare(mergeBase, headCommit),
  };
};

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.fetchConfiguredUpstream) {
    const ref = fetchConfiguredUpstream(options.fetchConfiguredUpstream);
    process.stdout.write('Fetched configured upstream tag ' + ref + '.\n');
  } else {
    const report = buildReport(options);
    const output =
      options.format === 'json'
        ? JSON.stringify(report, null, 2)
        : options.format === 'markdown'
        ? formatMarkdown(report)
        : formatText(report);
    process.stdout.write(output + '\n');
  }
} catch (error) {
  process.stderr.write('Source diff report failed: ' + error.message + '\n' + usage + '\n');
  process.exitCode = 1;
}
