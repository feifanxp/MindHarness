import type { TFunction } from 'i18next';
import type { BackgroundJob } from './backgroundJobsContract';

export type BackgroundJobsBarItem = {
  jobId: string;
  // The job's own name, for its row, its Stop button and errors.
  name: string;
  // Among several, its row says it waits for approval; one job's title says so.
  waiting: boolean;
  // Its cancel was sent from this client, or requested anywhere else.
  stopping: boolean;
};

export type BackgroundJobsBarModel = {
  title: string;
  items: BackgroundJobsBarItem[];
};

const jobName = (job: BackgroundJob, t: TFunction): string =>
  job.kind === 'subagent' ? t('mindroomUi.backgroundJobs.subagent', { tool: job.tool }) : job.tool;

const awaitingApproval = (job: BackgroundJob): boolean => job.status === 'awaiting_approval';

/** The jobs bar for a view's background jobs, or nothing when it has none. */
export const presentBackgroundJobs = (
  jobs: BackgroundJob[],
  // Whether this client sent a cancel for the job.
  cancelSent: (jobId: string) => boolean,
  t: TFunction
): BackgroundJobsBarModel | null => {
  const [first] = jobs;
  if (!first) return null;
  const several = jobs.length > 1;
  const items = jobs.map((job) => ({
    jobId: job.jobId,
    name: jobName(job, t),
    waiting: several && awaitingApproval(job),
    stopping: job.status === 'cancel_requested' || cancelSent(job.jobId),
  }));
  if (several)
    return { title: t('mindroomUi.backgroundJobs.jobCount', { count: jobs.length }), items };
  const tool = items[0].name;
  if (items[0].stopping)
    return { title: t('mindroomUi.backgroundJobs.stoppingJob', { tool }), items };
  if (awaitingApproval(first))
    return { title: t('mindroomUi.backgroundJobs.awaitingApproval', { tool }), items };
  return { title: t('mindroomUi.backgroundJobs.running', { tool }), items };
};
