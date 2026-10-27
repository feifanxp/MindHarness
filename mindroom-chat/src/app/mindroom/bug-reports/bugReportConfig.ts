import { useMemo } from 'react';
import type { AutoDiscoveryInfo } from '../../cs-api';
import { useAutoDiscoveryInfo } from '../../hooks/useAutoDiscoveryInfo';
import { isUserId } from '../../utils/matrix';

const BUG_REPORTS_WELL_KNOWN_KEY = 'io.mindroom.bug_reports';

/** Administrators that receive bug reports, from the homeserver's client well-known. */
export const getBugReportAdmins = (info: AutoDiscoveryInfo): string[] => {
  const section = info[BUG_REPORTS_WELL_KNOWN_KEY] as { admins?: unknown } | null | undefined;
  const admins = section?.admins;
  if (!Array.isArray(admins)) return [];
  return [
    ...new Set(
      admins.filter((admin): admin is string => typeof admin === 'string' && isUserId(admin))
    ),
  ];
};

/** Follows the well-known, which may load after the timeline mounts. */
export const useBugReportAdmins = (): string[] => {
  const info = useAutoDiscoveryInfo();
  return useMemo(() => getBugReportAdmins(info), [info]);
};
