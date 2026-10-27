import { expect, test } from '@playwright/test';

const TRACE = '/src/app/mindroom/diagnostics/deepTrace.ts';
const EXPORT = '/src/app/mindroom/diagnostics/diagnosticsExport.ts';
const THREAD = '/src/app/mindroom/threads/timelineDebug.ts';

test('exports thread and network evidence after a real IndexedDB connection is closed', async ({
  page,
}) => {
  // Keep app startup/navigation independent of the IndexedDB fault injection.
  await page.route('**/diagnostics-harness', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><body>Diagnostics harness</body>',
    })
  );
  await page.goto('/diagnostics-harness');
  await page.evaluate(async (tracePath) => {
    const trace = await import(tracePath);
    trace.initializeDeepTraceRecorder(localStorage);
    await trace.setDeepTraceEnabled(true);
    await trace.clearDeepTrace();
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      if (this.name === trace.DEEP_TRACE_DB_NAME && args[1] === 'readwrite') {
        IDBDatabase.prototype.transaction = original;
        this.close();
      }
      return Reflect.apply(original, this, args);
    };
    trace.recordDeepTraceEvent('thread.open.start', { trace_id: 100 }, { flush: true });
  }, TRACE);
  // The failed batch is written once on a new connection, and the failure stays visible.
  await expect
    .poll(() =>
      page.evaluate(async (path) => (await import(path)).getDeepTraceHealthSnapshot(), TRACE)
    )
    .toMatchObject({
      status: 'recording',
      pendingEventCount: 0,
      lastFailure: { stage: 'flush', errorName: 'InvalidStateError' },
    });
  const persisted = await page.evaluate(
    async (path) => (await (await import(path)).readDeepTraceSnapshot()).events,
    TRACE
  );
  expect(persisted.filter((event: { name: string }) => event.name === 'thread.open.start')).toEqual(
    [expect.objectContaining({ data: { trace_id: 100 } })]
  );

  const payload = await page.evaluate(
    async ([tracePath, exportPath, threadPath]) => {
      const trace = await import(tracePath);
      const thread = await import(threadPath);
      thread.logTimelineDebug(
        'thread-open#101#recorder-private-room#recorder-private-root',
        'thread-cache-hydrate-error'
      );
      await fetch('/config.json');
      const original = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (...args) {
        if (this.name === trace.DEEP_TRACE_DB_NAME)
          throw new DOMException('recorder-private-error', 'UnknownError');
        return Reflect.apply(original, this, args);
      };
      try {
        const exported = await (await import(exportPath)).buildDiagnosticsExport();
        return JSON.parse(await exported.blob.text());
      } finally {
        IDBDatabase.prototype.transaction = original;
        await trace.setDeepTraceEnabled(false);
      }
    },
    [TRACE, EXPORT, THREAD]
  );

  expect(payload.metadata.exportSchemaVersion).toBe(4);
  expect(payload.deepTrace.status).toBe('unavailable');
  expect(payload.deepTraceHealth.status).toBe('recording');
  expect(payload.deepTraceHealth.lastFailure).toMatchObject({
    stage: 'flush',
    errorName: 'UnknownError',
  });
  expect(payload.deepTraceMemory.storage).toBe('memory');
  expect(payload.deepTraceMemory.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'thread.open.start', data: { trace_id: 100 } }),
      expect.objectContaining({ name: 'thread.cache.error', data: { trace_id: 101 } }),
      expect.objectContaining({ name: 'network.app.get.complete' }),
    ])
  );
  expect(JSON.stringify(payload)).not.toContain('recorder-private');
});
