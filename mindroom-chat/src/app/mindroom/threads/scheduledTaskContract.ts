import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';

export const MINDROOM_SCHEDULED_TASK_EVENT = 'com.mindroom.scheduled.task';

type ScheduledTaskStateEventContent = Record<string, unknown> & {
  status?: unknown;
  workflow?: unknown;
  thread_id?: unknown;
  new_thread?: unknown;
  execute_at?: unknown;
  scheduled_at?: unknown;
  cron_description?: unknown;
};

type ScheduledTaskWorkflow = Record<string, unknown> & {
  thread_id?: unknown;
  new_thread?: unknown;
  execute_at?: unknown;
  scheduled_at?: unknown;
};

type ScheduledTaskDetails = {
  scheduleType?: 'once' | 'cron';
  message?: string;
  description?: string;
  cronExpression?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
  model?: string | null;
  silent?: boolean;
  isConditional?: boolean;
  historyLimit?: number | null;
};

type ParsedWorkflow = ScheduledTaskDetails & {
  threadId?: string | null;
  newThread?: boolean;
  executeAt?: string | null;
};

export type ParsedScheduledTask = ScheduledTaskDetails & {
  taskId: string;
  status: string;
  threadId: string | null;
  newThread: boolean;
  executeAt: string | null;
  cronDescription?: string;
};

export const parseScheduleTimestamp = (value: string | null | undefined): number | undefined => {
  if (!value) return undefined;
  // The scheduler treats offset-free ISO datetimes as UTC.
  const iso = value.replace(' ', 'T');
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(iso)
    ? `${iso}Z`
    : iso;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : undefined;
};

const parseThreadId = (value: unknown): string | null | undefined => {
  if (typeof value === 'string') return value;
  if (value === null) return null;
  return undefined;
};

const parseNewThread = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

const parseScheduledAt = (value: unknown): string | null | undefined => {
  if (typeof value === 'string') return value;
  if (value === null) return null;
  return undefined;
};

const parseCronDescription = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const description = value.trim();
  return description || undefined;
};

const parseDetails = (value: Record<string, unknown>): ScheduledTaskDetails => {
  const details: ScheduledTaskDetails = {};
  const strings = {
    message: 'message',
    description: 'description',
    createdBy: 'created_by',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  } as const;
  (Object.keys(strings) as (keyof typeof strings)[]).forEach((key) => {
    const field = value[strings[key]];
    if (typeof field === 'string' && field.trim()) details[key] = field;
  });
  if (value.schedule_type === 'once' || value.schedule_type === 'cron') {
    details.scheduleType = value.schedule_type;
  }
  if (typeof value.silent === 'boolean') details.silent = value.silent;
  if (typeof value.is_conditional === 'boolean') details.isConditional = value.is_conditional;
  if (value.model === null) details.model = null;
  if (typeof value.model === 'string') details.model = value.model.trim() || null;
  if (value.history_limit === null) details.historyLimit = null;
  if (
    typeof value.history_limit === 'number' &&
    Number.isInteger(value.history_limit) &&
    value.history_limit >= 0
  ) {
    details.historyLimit = value.history_limit;
  }
  const cron = value.cron_schedule;
  if (cron && typeof cron === 'object' && !Array.isArray(cron)) {
    const fields = ['minute', 'hour', 'day', 'month', 'weekday'].map(
      (key) => (cron as Record<string, unknown>)[key] ?? '*'
    );
    if (fields.every((field) => typeof field === 'string' && field.trim())) {
      details.cronExpression = fields.join(' ');
    }
  }
  return details;
};

const parseWorkflow = (workflow: unknown): ParsedWorkflow | null => {
  if (workflow === undefined) return {};

  let parsedWorkflow: unknown = workflow;

  if (typeof workflow === 'string') {
    try {
      parsedWorkflow = JSON.parse(workflow);
    } catch {
      return null;
    }
  }

  if (!parsedWorkflow || typeof parsedWorkflow !== 'object' || Array.isArray(parsedWorkflow)) {
    return null;
  }

  const {
    thread_id: threadIdValue,
    new_thread: newThreadValue,
    execute_at: executeAtValue,
    scheduled_at: scheduledAtValue,
  } = parsedWorkflow as ScheduledTaskWorkflow;

  return {
    ...parseDetails(parsedWorkflow as ScheduledTaskWorkflow),
    threadId: parseThreadId(threadIdValue),
    newThread: parseNewThread(newThreadValue),
    executeAt: parseScheduledAt(executeAtValue) ?? parseScheduledAt(scheduledAtValue) ?? null,
  };
};

export const parseScheduledTaskStateEvent = (event: MatrixEvent): ParsedScheduledTask | null => {
  const taskId = event.getStateKey();
  if (typeof taskId !== 'string') return null;

  const content = event.getContent<ScheduledTaskStateEventContent>();
  if (!content || typeof content !== 'object') return null;

  const {
    status,
    thread_id: topLevelThreadId,
    new_thread: topLevelNewThread,
    execute_at: topLevelExecuteAt,
    scheduled_at: topLevelScheduledAt,
    cron_description: topLevelCronDescription,
    workflow,
  } = content;
  if (typeof status !== 'string') return null;

  const parsedWorkflow = parseWorkflow(workflow);
  const parsedTopLevelThreadId = parseThreadId(topLevelThreadId);
  const parsedTopLevelNewThread = parseNewThread(topLevelNewThread);
  const parsedTopLevelExecuteAt =
    parseScheduledAt(topLevelExecuteAt) ?? parseScheduledAt(topLevelScheduledAt);
  const cronDescription = parseCronDescription(topLevelCronDescription);

  if (
    workflow !== undefined &&
    parsedWorkflow === null &&
    (parsedTopLevelThreadId === undefined || parsedTopLevelNewThread === undefined)
  ) {
    return null;
  }

  return {
    ...parsedWorkflow,
    ...parseDetails(content),
    taskId,
    status,
    threadId:
      parsedTopLevelThreadId !== undefined
        ? parsedTopLevelThreadId
        : parsedWorkflow?.threadId ?? null,
    newThread: parsedTopLevelNewThread ?? parsedWorkflow?.newThread ?? false,
    executeAt: parsedTopLevelExecuteAt ?? parsedWorkflow?.executeAt ?? null,
    ...(cronDescription ? { cronDescription } : {}),
  };
};
