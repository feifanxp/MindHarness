import { useCallback, useSyncExternalStore } from 'react';

/** For each job of a room this client sent a cancel for, the requests that sent one. */
export type SentCancels = ReadonlyMap<string, ReadonlySet<number>>;

const NONE: SentCancels = new Map();
// Kept outside the bar, so a job stays "Stopping…" while the bar is unmounted, as when a canvas fills the room.
const byRoom = new Map<string, SentCancels>();
const listeners = new Set<() => void>();
let lastRequest = 0;

const update = (roomId: string, change: (sent: SentCancels) => SentCancels): void => {
  const previous = byRoom.get(roomId) ?? NONE;
  const next = change(previous);
  if (next === previous) return;
  if (next.size === 0) byRoom.delete(roomId);
  else byRoom.set(roomId, next);
  listeners.forEach((listener) => listener());
};

/** Mark the jobs one cancel request names, and return the request. */
export const markCancelSent = (roomId: string, jobIds: readonly string[]): number => {
  lastRequest += 1;
  const request = lastRequest;
  update(
    roomId,
    (sent) =>
      new Map([
        ...sent,
        ...jobIds.map((jobId): [string, ReadonlySet<number>] => [
          jobId,
          new Set([...(sent.get(jobId) ?? []), request]),
        ]),
      ])
  );
  return request;
};

/** Forget a request whose send failed; a job another request also reached stays marked. */
export const forgetCancel = (roomId: string, request: number): void =>
  update(
    roomId,
    (sent) =>
      new Map(
        [...sent]
          .map(([jobId, requests]): [string, ReadonlySet<number>] => [
            jobId,
            new Set([...requests].filter((other) => other !== request)),
          ])
          .filter(([, requests]) => requests.size > 0)
      )
  );

/** Forget the jobs that left the room's published jobs. */
export const keepCancelsOf = (roomId: string, liveJobIds: ReadonlySet<string>): void =>
  update(roomId, (sent) => {
    const kept = [...sent].filter(([jobId]) => liveJobIds.has(jobId));
    return kept.length === sent.size ? sent : new Map(kept);
  });

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The jobs of a room this client sent a cancel for. */
export const useSentCancels = (roomId: string): SentCancels =>
  useSyncExternalStore(
    subscribe,
    useCallback(() => byRoom.get(roomId) ?? NONE, [roomId])
  );
