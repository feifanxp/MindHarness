import { createInstance, type TFunction } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../../locales/en.json';
import type { BackgroundJob } from './backgroundJobsContract';
import { presentBackgroundJobs } from './backgroundJobsPresentation';

let t: TFunction;
const none = () => false;

beforeAll(async () => {
  const language = createInstance();
  await language.init({ lng: 'en', resources: { en: { translation: en } } });
  t = language.t;
});

const job = (jobId: string, overrides: Partial<BackgroundJob> = {}): BackgroundJob => ({
  jobId,
  threadId: '$thread',
  kind: 'tool',
  tool: 'run_tests',
  status: 'running',
  startedAt: `2026-10-11T00:00:0${jobId.slice(-1)}+00:00`,
  ...overrides,
});

describe('presentBackgroundJobs', () => {
  it('returns nothing without jobs', () => {
    expect(presentBackgroundJobs([], none, t)).toBeNull();
  });

  it('names a single running job', () => {
    expect(presentBackgroundJobs([job('job_1')], none, t)?.title).toBe('Running: run_tests');
  });

  it('names a single job waiting for approval', () => {
    const presented = presentBackgroundJobs(
      [job('job_1', { status: 'awaiting_approval' })],
      none,
      t
    );
    expect(presented?.title).toBe('Waiting for approval: run_tests');
    expect(presented?.items[0]).toMatchObject({ name: 'run_tests', waiting: false });
  });

  it('marks a job whose cancel was already requested as stopping', () => {
    const presented = presentBackgroundJobs(
      [job('job_1', { status: 'cancel_requested' }), job('job_2')],
      none,
      t
    );
    expect(presented?.items.map((item) => item.stopping)).toEqual([true, false]);
  });

  it('names a single job that is stopping, whether its cancel was sent here or elsewhere', () => {
    const elsewhere = presentBackgroundJobs(
      [job('job_1', { status: 'cancel_requested' })],
      none,
      t
    );
    expect(elsewhere?.title).toBe('Stopping: run_tests');
    const here = presentBackgroundJobs([job('job_1')], (jobId) => jobId === 'job_1', t);
    expect(here?.title).toBe('Stopping: run_tests');
    expect(here?.items[0].stopping).toBe(true);
  });

  it('counts several jobs and lists them in order', () => {
    const presented = presentBackgroundJobs(
      [job('job_1'), job('job_2', { tool: 'download' })],
      none,
      t
    );
    expect(presented?.title).toBe('2 background jobs');
    expect(presented?.items.map((item) => item.name)).toEqual(['run_tests', 'download']);
  });

  it('marks a job waiting for approval among several', () => {
    const presented = presentBackgroundJobs(
      [job('job_1'), job('job_2', { tool: 'shell', status: 'awaiting_approval' })],
      none,
      t
    );
    expect(presented?.items.map((item) => item.waiting)).toEqual([false, true]);
    expect(presented?.items.map((item) => item.name)).toEqual(['run_tests', 'shell']);
  });

  it('shows a job with an unknown status as running and stoppable', () => {
    const presented = presentBackgroundJobs([job('job_1', { status: 'paused' })], none, t);
    expect(presented?.title).toBe('Running: run_tests');
    expect(presented?.items[0]).toMatchObject({ name: 'run_tests', stopping: false });
  });

  it('labels a subagent by its tool and an unknown kind by its tool', () => {
    const presented = presentBackgroundJobs(
      [job('job_1', { kind: 'subagent', tool: 'run_subagent' }), job('job_2', { kind: 'new' })],
      none,
      t
    );
    expect(presented?.items.map((item) => item.name)).toEqual([
      'run_subagent (subagent)',
      'run_tests',
    ]);
  });
});
