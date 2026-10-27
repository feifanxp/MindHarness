import { parseToolApprovalExpiryTimestamp, ToolApprovalScheduledScope } from './toolApproval';

// Backend timestamps can carry sub-millisecond fractions that browser date parsing rejects.
export const formatApprovalTime = (value: string, language: string): string => {
  const timestamp = parseToolApprovalExpiryTimestamp(value);
  return timestamp === undefined ? value : new Date(timestamp).toLocaleString(language);
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** "in 20 minutes", "in 24 hours", "in 3 days"; undefined once the time has passed. */
export const formatExpiryDistance = (
  value: string,
  now: number,
  language: string
): string | undefined => {
  const timestamp = parseToolApprovalExpiryTimestamp(value);
  if (timestamp === undefined || timestamp <= now) return undefined;
  const remaining = timestamp - now;
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'always' });
  if (remaining < HOUR_MS)
    return format.format(Math.max(1, Math.round(remaining / MINUTE_MS)), 'minute');
  if (remaining < 48 * HOUR_MS) return format.format(Math.round(remaining / HOUR_MS), 'hour');
  return format.format(Math.round(remaining / (24 * HOUR_MS)), 'day');
};

// One label per scope, shared by scheduling cards and send-time receipts.
export const scheduledScopeLabelKey = (scope: ToolApprovalScheduledScope) =>
  scope === 'any_arguments'
    ? ('mindroomUi.messages.approvalSchedule.approvedAnyArguments' as const)
    : ('mindroomUi.messages.approvalSchedule.approvedExactArguments' as const);
