import { describe, expect, it } from 'vitest';
import type { AutoDiscoveryInfo } from '../../cs-api';
import { getBugReportAdmins } from './bugReportConfig';

const info = (extra: Record<string, unknown>): AutoDiscoveryInfo =>
  ({ 'm.homeserver': { base_url: 'https://hs.example' }, ...extra } as AutoDiscoveryInfo);

describe('getBugReportAdmins', () => {
  it('returns valid, unique admin user IDs', () => {
    expect(
      getBugReportAdmins(
        info({
          'io.mindroom.bug_reports': {
            admins: ['@admin:example.com', '@admin:example.com', '@ops:example.com'],
          },
        })
      )
    ).toEqual(['@admin:example.com', '@ops:example.com']);
  });

  it('ignores entries that are not Matrix user IDs', () => {
    expect(
      getBugReportAdmins(
        info({
          'io.mindroom.bug_reports': {
            admins: ['admin', 42, '!room:example.com', '@ok:example.com'],
          },
        })
      )
    ).toEqual(['@ok:example.com']);
  });

  it('treats a missing or malformed key as not configured', () => {
    expect(getBugReportAdmins(info({}))).toEqual([]);
    expect(getBugReportAdmins(info({ 'io.mindroom.bug_reports': [] }))).toEqual([]);
    expect(getBugReportAdmins(info({ 'io.mindroom.bug_reports': { admins: '@a:b.c' } }))).toEqual(
      []
    );
  });
});
