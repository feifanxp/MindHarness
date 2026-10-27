import { createClient, Direction } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.useRealTimers());

describe('relations HTTP cancellation', () => {
  it.each(['cancel', 'timeout'] as const)(
    'keeps %s active after headers while downloading the body',
    async (action) => {
      vi.useFakeTimers();
      const parent = new AbortController();
      let body: ReadableStreamDefaultController<Uint8Array>;
      let networkSignal: AbortSignal;
      const mx = createClient({
        baseUrl: 'https://example.org',
        fetchFn: vi.fn(async (_url, options) => {
          networkSignal = options!.signal!;
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              body = controller;
            },
          });
          networkSignal.addEventListener(
            'abort',
            () => body.error(new DOMException('Aborted', 'AbortError')),
            { once: true }
          );
          return new Response(stream, { headers: { 'Content-Type': 'application/json' } });
        }),
      });
      const request = mx.fetchRelations('!room:example.org', '$root', null, null, {
        abortSignal: parent.signal,
        localTimeoutMs: 100,
        dir: Direction.Backward,
        recurse: true,
      });
      // Attach immediately: the transport can reject during timer advancement.
      const outcome = request.catch((error: Error) => error);
      try {
        await vi.advanceTimersByTimeAsync(0);
        if (action === 'cancel') parent.abort();
        else await vi.advanceTimersByTimeAsync(100);
        expect(networkSignal!.aborted).toBe(true);
        expect(await outcome).toMatchObject({ name: 'AbortError' });
      } finally {
        body!.error(new DOMException('Cleanup', 'AbortError'));
        await outcome;
      }
    }
  );

  it('keeps transport controls out of the Matrix relations query', async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request) => new Response('{"chunk":[]}'));
    const mx = createClient({ baseUrl: 'https://example.org', fetchFn });
    await mx.fetchRelations('!room:example.org', '$root', null, null, {
      abortSignal: new AbortController().signal,
      localTimeoutMs: 100,
      dir: Direction.Backward,
      recurse: true,
      from: 'page',
      limit: 200,
    });
    const url = new URL(fetchFn.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/_matrix/client/v1/rooms/!room%3Aexample.org/relations/%24root');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      dir: 'b',
      recurse: 'true',
      from: 'page',
      limit: '200',
    });
  });
});
