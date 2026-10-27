import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { afterEach, expect, it } from 'vitest';
import { MINDROOM_BACKGROUND_JOBS_EVENT, type BackgroundJob } from './backgroundJobsContract';
import { useRoomBackgroundJobs } from './useRoomBackgroundJobs';

const viewer = '@alice:example.org';
const agent = '@mindroom_code:example.org';
let serial = 0;
let renderer: ReactTestRenderer | undefined;

const stateEvent = (type: string, stateKey: string, content: Record<string, unknown>) => {
  serial += 1;
  return new MatrixEvent({
    type,
    state_key: stateKey,
    sender: type === 'm.room.topic' ? viewer : stateKey,
    room_id: '!room:example.org',
    event_id: `$state${serial}`,
    origin_server_ts: serial,
    content,
  });
};

const jobsEvent = (jobIds: string[]) =>
  stateEvent(MINDROOM_BACKGROUND_JOBS_EVENT, agent, {
    jobs: jobIds.map((jobId) => ({
      job_id: jobId,
      thread_id: null,
      kind: 'tool',
      tool: 'run_tests',
      status: 'running',
      requester_id: viewer,
      started_at: '2026-10-11T00:00:00+00:00',
    })),
  });

const membership = (value: string) => stateEvent('m.room.member', agent, { membership: value });

const makeRoom = (lazyLoadMembers = false) =>
  new Room(
    '!room:example.org',
    createClient({ baseUrl: 'http://localhost:1', userId: viewer, timelineSupport: true }),
    viewer,
    { timelineSupport: true, lazyLoadMembers }
  );

const mount = (room: Room) => {
  const seen: BackgroundJob[][] = [];
  function Probe() {
    seen.push(useRoomBackgroundJobs(room));
    return null;
  }
  act(() => {
    renderer = create(<Probe />);
  });
  return seen;
};

const addState = (room: Room, event: MatrixEvent) =>
  act(async () => {
    await room.addLiveEvents([event], { addToState: true });
  });

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

it('keeps following the jobs after a gappy sync replaces the live state', async () => {
  const room = makeRoom();
  await room.addLiveEvents([membership('join'), jobsEvent(['job_1'])], { addToState: true });
  const seen = mount(room);
  expect(seen.at(-1)?.map((job) => job.jobId)).toEqual(['job_1']);

  act(() => room.resetLiveTimeline('prev_batch', 'old_sync_token'));
  await addState(room, jobsEvent([]));

  expect(seen.at(-1)).toEqual([]);
});

it('shows an agent whose membership is not loaded yet, and drops it once it is known to have left', async () => {
  const room = makeRoom(true);
  await room.addLiveEvents([jobsEvent(['job_1'])], { addToState: true });
  const seen = mount(room);
  expect(seen.at(-1)?.map((job) => job.jobId)).toEqual(['job_1']);

  act(() => {
    const state = room.currentState;
    state.markOutOfBandMembersStarted();
    state.setOutOfBandMembers([membership('leave')]);
  });

  expect(seen.at(-1)).toEqual([]);
});

it('does not render again for unrelated room state', async () => {
  const room = makeRoom();
  await room.addLiveEvents([membership('join'), jobsEvent(['job_1'])], { addToState: true });
  const seen = mount(room);
  const renders = seen.length;

  await addState(room, stateEvent('m.room.topic', '', { topic: 'Release prep' }));

  expect(seen).toHaveLength(renders);
});
