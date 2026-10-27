import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plan, reportPassed, runJobs } from './test-e2e-parallel.mjs';

test('requires executed passing cases and complete reports', () => {
  const report = { stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 1 }, errors: [] };
  assert.equal(reportPassed(report, 0, 2), true);
  assert.equal(reportPassed(report, 1, 2), false);
  assert.equal(reportPassed(report, 0, 3), false);
  assert.equal(reportPassed({ ...report, stats: { ...report.stats, expected: 0 } }, 0, 1), false);
});

const discovery = (config, project, file = 'chat.spec.ts') => ({
  config,
  report: {
    config: { rootDir: '/repo/e2e' },
    suites: [{ specs: [{ file, title: 'works', tests: [{ projectName: project }] }] }],
  },
});

test('deduplicates shared Chromium coverage while retaining other browsers and serial specs', () => {
  const jobs = plan(
    [
      discovery('default', 'chromium'),
      discovery('extra', 'chromium'),
      discovery('extra', 'webkit'),
      discovery('default', 'chromium', 'live/perf-scroll.spec.ts'),
    ],
    '/repo'
  );
  assert.deepEqual(
    jobs.map(({ file, project, cases, serial }) => [file, project, cases, serial]),
    [
      ['e2e/chat.spec.ts', 'chromium', 1, false],
      ['e2e/chat.spec.ts', 'webkit', 1, false],
      ['e2e/live/perf-scroll.spec.ts', 'chromium', 1, true],
    ]
  );
});

test('keeps the manifest-owned streaming benchmark out of disposable-account jobs', () => {
  const jobs = plan(
    [
      discovery('default', 'chromium', 'live/perf-large-room-streaming.spec.ts'),
      discovery('default', 'chromium', 'live/perf-thread-streaming.spec.ts'),
      discovery('default', 'chromium'),
    ],
    '/repo'
  );
  assert.deepEqual(
    jobs.map(({ file }) => file),
    ['e2e/live/perf-thread-streaming.spec.ts', 'e2e/chat.spec.ts']
  );
});

test('rejects discovery errors and incompatible subsets instead of dropping cases', () => {
  assert.throws(() => plan([{ config: 'broken', report: { errors: ['failed'] } }], '/repo'));
  const extra = discovery('filtered', 'chromium');
  extra.report.suites[0].specs[0].title = 'another case';
  assert.throws(() => plan([discovery('default', 'chromium'), extra], '/repo'));
});

test('bounds concurrency, continues after failure, and runs serial jobs only after the pool', async () => {
  const jobs = [{ file: 'a' }, { file: 'b' }, { file: 'c' }, { file: 'serial', serial: true }];
  let active = 0;
  let peak = 0;
  const started = [];
  const release = [];
  const running = runJobs(jobs, 2, async ({ file, serial }) => {
    started.push(file);
    if (serial) assert.equal(active, 0);
    active += 1;
    peak = Math.max(peak, active);
    if (file === 'a' || file === 'b')
      await new Promise((resolve) => {
        release.push(resolve);
      });
    active -= 1;
    if (file === 'b') throw new Error('fixture failed');
    return { status: 'passed' };
  });
  assert.deepEqual(started, ['a', 'b']);
  release.forEach((resolve) => resolve());
  const results = await running;
  assert.equal(peak, 2);
  assert.equal(started.at(-1), 'serial');
  assert.equal(results.find(({ file }) => file === 'b').status, 'failed');
  assert.equal(results.filter(({ status }) => status === 'passed').length, 3);
});
