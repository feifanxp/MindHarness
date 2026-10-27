// @vitest-environment jsdom

import { MatrixClient, Room } from 'matrix-js-sdk';
import { Widget } from 'matrix-widget-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CallEmbed } from './CallEmbed';

vi.mock('matrix-widget-api', () => ({
  ClientWidgetApi: class {
    transport = {};

    on = vi.fn();

    off = vi.fn();

    setViewedRoomId = vi.fn();
  },
  WidgetApiToWidgetAction: {},
}));
vi.mock('./CallWidgetDriver', () => ({ CallWidgetDriver: class {} }));
vi.mock('./CallControl', () => ({
  CallControl: class {
    startObserving = vi.fn();
  },
}));

const embedFor = (liveEvents: Array<{ getTs: () => number }>) =>
  new CallEmbed(
    {
      getSafeUserId: () => '@alice:example.org',
      getRooms: () => [],
      on: vi.fn(),
    } as unknown as MatrixClient,
    {
      roomId: '!call:example.org',
      getLiveTimeline: () => ({ getEvents: () => liveEvents }),
    } as unknown as Room,
    { getCompleteUrl: () => 'about:blank' } as unknown as Widget,
    document.createElement('div'),
    'Call'
  );

describe('CallEmbed.startedAfterTs', () => {
  afterEach(() => vi.restoreAllMocks());

  it("is the newest live event's server timestamp, whatever the device clock says", () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000 + 30_000);

    expect(embedFor([{ getTs: () => 900_000 }, { getTs: () => 1_000_000 }]).startedAfterTs).toBe(
      1_000_000
    );
  });

  it('is undefined for a room without events', () => {
    expect(embedFor([]).startedAfterTs).toBeUndefined();
  });
});
