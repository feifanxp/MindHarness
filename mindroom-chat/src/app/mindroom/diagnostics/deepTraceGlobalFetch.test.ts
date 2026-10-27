// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';

it('captures direct application fetches through the stable global delegate', async () => {
  vi.resetModules();
  const originalFetch = window.fetch;
  const baseFetch = vi
    .fn()
    .mockResolvedValue(new Response('{}', { status: 200, headers: { 'content-length': '2' } }));
  window.fetch = baseFetch;
  const trace = await import('./deepTrace');
  const storage = window.localStorage;
  storage.clear();
  const dispose = trace.initializeDeepTraceRecorder(storage);
  await trace.clearDeepTrace();

  try {
    expect(await trace.setDeepTraceEnabled(true, storage)).toBe(true);
    await window.fetch('/config.json');

    const events = (await trace.readDeepTraceSnapshot()).events;
    expect(events.map((event) => event.name)).toEqual(
      expect.arrayContaining(['network.app.get.start', 'network.app.get.complete'])
    );
    expect(baseFetch).toHaveBeenCalledOnce();
  } finally {
    await trace.setDeepTraceEnabled(false, storage);
    dispose();
    await trace.clearDeepTrace();
    window.fetch = originalFetch;
  }
});
