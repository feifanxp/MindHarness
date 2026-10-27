import type { BrowserContext, Page } from '@playwright/test';
import type {
  CachedAttachmentReferenceRecord,
  CachedEventRecord,
} from '../../src/app/mindroom/threads/cacheStore/cacheStoreSchema';

type FreshnessProbe = {
  heldBodies: number;
  settledBodies: number;
  heldImages: number;
  discardedImages: number;
  releaseNetwork: () => void;
  releaseOldWork: () => void;
};

declare global {
  interface Window {
    __offlineFreshness: FreshnessProbe;
  }
}

/** Delay real cached-body decoding and a real old-image response, without holding IDB transactions. */
export const installOfflineFreshnessGates = async (
  context: BrowserContext,
  oldBody: string,
  oldImageUri: string,
  oldImageBytes: number[]
): Promise<void> => {
  await context.addInitScript(
    ({ body, imageId, imageBytes }) => {
      const probe = {} as FreshnessProbe;
      const network = new Promise<void>((resolve) => {
        probe.releaseNetwork = resolve;
      });
      const oldWork = new Promise<void>((resolve) => {
        probe.releaseOldWork = resolve;
      });
      Object.assign(probe, { heldBodies: 0, settledBodies: 0, heldImages: 0, discardedImages: 0 });
      window.__offlineFreshness = probe;

      const text = Blob.prototype.text;
      const reads = new WeakMap<Blob, number>();
      Blob.prototype.text = async function delayedBody() {
        const value = await text.call(this);
        if (!value.includes(body)) return value;
        const count = (reads.get(this) ?? 0) + 1;
        reads.set(this, count);
        if (count === 1) {
          probe.heldBodies += 1;
          await oldWork;
        } else {
          // The second read is the hydration loader, after repository persistence settled.
          probe.settledBodies += 1;
        }
        return value;
      };

      const fetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.includes('/_matrix/')) {
          if (new URL(url, location.href).pathname.endsWith(`/${imageId}`)) {
            const response = await fetch(input, init);
            probe.heldImages += 1;
            await oldWork;
            return response;
          }
          await network;
        }
        return fetch(input, init);
      };

      const create = URL.createObjectURL.bind(URL);
      const revoke = URL.revokeObjectURL.bind(URL);
      const oldUrls = new Set<string>();
      const revoked = new Set<string>();
      const updateDiscarded = () => {
        probe.discardedImages = [...oldUrls].filter((url) => revoked.has(url)).length;
      };
      URL.createObjectURL = (blob) => {
        const url = create(blob);
        if (blob instanceof Blob && blob.size === imageBytes.length) {
          void blob.arrayBuffer().then((buffer) => {
            if (new Uint8Array(buffer).every((byte, index) => byte === imageBytes[index])) {
              oldUrls.add(url);
              updateDiscarded();
            }
          });
        }
        return url;
      };
      URL.revokeObjectURL = (url) => {
        revoked.add(url);
        revoke(url);
        updateDiscarded();
      };
    },
    { body: oldBody, imageId: oldImageUri.split('/').at(-1)!, imageBytes: oldImageBytes }
  );
};

export const readOfflineFreshness = (
  page: Page,
  dbName: string,
  roomId: string,
  eventIds: string[],
  oldUris: string[]
) =>
  page.evaluate(
    async ({ name, room, ids, uris }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const transaction = db.transaction(
          ['events', 'attachments', 'attachment_references'],
          'readonly'
        );
        const result = <T>(request: IDBRequest<T>): Promise<T> =>
          new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
        const [events, references, oldBytes] = await Promise.all([
          result(transaction.objectStore('events').getAll()) as Promise<CachedEventRecord[]>,
          result(
            transaction.objectStore('attachment_references').index('by_room').getAll(room)
          ) as Promise<CachedAttachmentReferenceRecord[]>,
          Promise.all(uris.map((uri) => result(transaction.objectStore('attachments').get(uri)))),
        ]);
        const liveEvents = events.filter(
          (row) =>
            row.roomId === room &&
            ids.includes(row.eventId) &&
            !row.rawEvent.unsigned?.redacted_because
        );
        return {
          oldBytes: oldBytes.filter(Boolean).length,
          liveEventIds: [...new Set(liveEvents.map((row) => row.eventId))].sort(),
          mediaUris: [
            ...new Set(
              liveEvents
                .map((row) => {
                  const replacement = row.rawEvent.unsigned?.['m.relations']?.['m.replace'];
                  return (replacement?.content?.['m.new_content'] ?? row.rawEvent.content)?.url;
                })
                .filter((uri): uri is string => typeof uri === 'string')
            ),
          ].sort(),
          references: references
            .filter((row) => ids.includes(row.eventId ?? ''))
            .map((row) => ({
              eventId: row.eventId,
              mxcUri: row.mxcUri,
              revisionId: row.revisionId ?? '',
              redacted: !!row.redacted,
            }))
            .sort((a, b) => (a.eventId ?? '').localeCompare(b.eventId ?? '')),
        };
      } finally {
        db.close();
      }
    },
    { name: dbName, room: roomId, ids: eventIds, uris: oldUris }
  );
