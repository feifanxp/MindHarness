import React from 'react';
import { act, create } from 'react-test-renderer';
import { createClient, MatrixEvent, Room, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompactThreadCardViewModel, ThreadRecord } from './types';
import { useCompactThreadCardViewModels } from './compactThreadCardViewModel';

const state = vi.hoisted(() => ({
  mx: undefined as MatrixClient | undefined,
  locale: 'en',
  authenticated: false,
  t: vi.fn((key: string, options?: Record<string, unknown>) =>
    options ? key + JSON.stringify(options) : key
  ),
}));
vi.mock('../../hooks/useMatrixClient', () => ({ useMatrixClient: () => state.mx }));
vi.mock('../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => state.authenticated,
}));
vi.mock('../../hooks/useAppLanguageCode', () => ({ useAppLanguageCode: () => state.locale }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: state.t }) }));

const record = (id: string, count = 1000): ThreadRecord => ({
  roomId: '!room:server',
  threadRootId: id,
  absoluteIndex: 0,
  cache: { eventCount: 0, relationSnapshotComplete: false, tailLoaded: false },
  presentation: {
    summaryInfo: undefined,
    summaryText: undefined,
    rootPreviewText: 'Conversation with @alice:server',
    latestReplyPreviewText: 'Reply from @bob:server',
    lastSenderId: '@alice:server',
    lastSenderDisplayName: undefined,
    messageCount: count,
    participantIds: ['@alice:server'],
    replyParticipantIds: ['@alice:server'],
    primarySummaryText: undefined,
    recentThreadSummaryText: undefined,
  },
  status: {
    isKnownThreadRoot: true,
    replyCount: count,
    isResolved: false,
    isUnread: false,
    isStreaming: false,
    scheduledTaskCount: 0,
    lastActivityTs: 1000,
    tags: [],
  },
});

const setMember = (room: Room, userId: string, name: string, avatar = 'mxc://server/avatar') =>
  room.currentState.setStateEvents([
    new MatrixEvent({
      type: 'm.room.member',
      room_id: room.roomId,
      state_key: userId,
      sender: userId,
      event_id: '$' + name,
      content: { membership: 'join', displayname: name, avatar_url: avatar },
    }),
  ]);

function mount(room: Room, records: ThreadRecord[]) {
  let latest: CompactThreadCardViewModel[] = [];
  const Harness = ({ values }: { values: ThreadRecord[] }) => {
    latest = useCompactThreadCardViewModels({
      room,
      threadRootIds: values.map((value) => value.threadRootId),
      threadRecordMap: new Map(values.map((value) => [value.threadRootId, value])),
    });
    return null;
  };
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(<Harness values={records} />);
  });
  return {
    get models() {
      return latest;
    },
    update(values: ThreadRecord[]) {
      act(() => renderer.update(<Harness values={values} />));
    },
    unmount() {
      act(() => renderer.unmount());
    },
  };
}

let room: Room;
beforeEach(() => {
  state.mx = createClient({
    baseUrl: 'https://matrix.example',
    userId: '@me:server',
    accessToken: 'first-token',
  });
  state.locale = 'en';
  state.authenticated = false;
  state.t.mockClear();
  room = new Room('!room:server', state.mx, '@me:server');
  setMember(room, '@alice:server', 'Alice');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('compact card formatting work', () => {
  it('skips formatting unchanged values even when records and cache coverage are rebuilt', () => {
    const format = vi.spyOn(Intl.NumberFormat.prototype, 'format', 'get');
    const harness = mount(room, [record('$a'), record('$b')]);
    const original = harness.models;
    // Each built card formats its count twice: the label and the bare number.
    expect(format).toHaveBeenCalledTimes(4);
    const rebuilt = [record('$a'), record('$b')];
    rebuilt[0].absoluteIndex = 10;
    rebuilt[0].cache.eventCount = 500;
    harness.update(rebuilt);
    expect(harness.models[0]).toBe(original[0]);
    expect(harness.models[1]).toBe(original[1]);
    expect(format).toHaveBeenCalledTimes(4);

    harness.update([record('$a', 1001), record('$b')]);
    expect(harness.models[0].messageCount).toBe(1001);
    expect(harness.models[1]).toBe(original[1]);
    expect(format).toHaveBeenCalledTimes(6);
    harness.unmount();
  });

  it('refreshes mutable member names, avatars, resolver names, and newly loaded inline mentions', () => {
    const first = record('$a');
    first.status.isResolved = true;
    first.status.resolvedByUserId = '@alice:server';
    const harness = mount(room, [first]);
    expect(harness.models[0].titleText).toContain('Alice');
    expect(harness.models[0].previewText).toContain('@bob:server');
    const oldAvatar = harness.models[0].participants[0].avatarUrl;

    setMember(room, '@alice:server', 'Alicia', 'mxc://server/new-avatar');
    setMember(room, '@bob:server', 'Bob');
    harness.update([structuredClone(first)]);
    expect(harness.models[0].titleText).toContain('Alicia');
    expect(harness.models[0].previewText).toContain('Bob');
    expect(harness.models[0].resolvedByDisplayName).toBe('Alicia');
    expect(harness.models[0].participants[0].avatarUrl).not.toBe(oldAvatar);
    harness.unmount();
  });

  it('refreshes locale, media authentication, and native token changes', () => {
    const harness = mount(room, [record('$a')]);
    expect(harness.models[0].messageCountLabel).toContain('1,000');
    const publicAvatar = harness.models[0].participants[0].avatarUrl;
    state.locale = 'de';
    state.authenticated = true;
    harness.update([record('$a')]);
    expect(harness.models[0].messageCountLabel).toContain('1.000');
    expect(harness.models[0].participants[0].avatarUrl).not.toBe(publicAvatar);

    vi.stubGlobal('window', { location: { protocol: 'capacitor:' } });
    harness.update([record('$a')]);
    expect(harness.models[0].participants[0].avatarUrl).toContain('access_token=first-token');
    state.mx!.setAccessToken('second-token');
    harness.update([record('$a')]);
    expect(harness.models[0].participants[0].avatarUrl).toContain('access_token=second-token');
    harness.unmount();
  });

  it('keeps scheduled countdowns current when record values stay unchanged', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10000);
    const scheduled = record('$a');
    scheduled.status.scheduledTaskCount = 1;
    scheduled.status.nextScheduledTs = 20000;
    const harness = mount(room, [scheduled]);
    const previous = harness.models[0].scheduledDisplayText;
    vi.setSystemTime(15000);
    harness.update([structuredClone(scheduled)]);
    expect(harness.models[0].scheduledDisplayText).not.toBe(previous);
    harness.unmount();
  });

  it('refreshes action, unread, streaming, and pending-send state mutated in place', () => {
    const value = record('$a');
    const harness = mount(room, [value]);
    Object.assign(value.status, {
      isUnread: true,
      isStreaming: true,
      isResolved: true,
      hasPendingSend: true,
      hasFailedSend: true,
      tags: ['urgent'],
    });
    harness.update([value]);
    expect(harness.models[0]).toMatchObject({
      isUnread: true,
      isStreaming: true,
      isResolved: true,
      hasPendingSend: true,
      hasFailedSend: true,
      tags: ['urgent'],
    });
    harness.unmount();
  });

  it('refreshes attention and avatar URLs when the account changes', () => {
    const harness = mount(room, [record('$a')]);
    expect(harness.models[0].attentionState).toBe('needs-attention');
    state.mx = createClient({ baseUrl: 'https://other.example', userId: '@alice:server' });
    harness.update([record('$a')]);
    expect(harness.models[0].attentionState).toBe('waiting');
    expect(harness.models[0].participants[0].avatarUrl).toContain('https://other.example/');
    harness.unmount();
  });
});
