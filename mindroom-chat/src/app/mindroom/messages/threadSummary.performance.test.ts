import { EventStatus, MatrixEvent, Room, createClient } from 'matrix-js-sdk';
import type { CryptoBackend } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { afterEach, expect, it, vi } from 'vitest';
import {
  getLatestThreadSummaryInfoFromEventSources,
  getThreadSummaryEventInfo,
  getThreadSummaryInfosFromEventSources,
} from './threadSummary';

const notice = (id: string, text: string, timestamp = 1000) =>
  new MatrixEvent({
    event_id: id,
    type: 'm.room.message',
    origin_server_ts: timestamp,
    content: {
      msgtype: 'm.notice',
      body: text,
      'io.mindroom.thread_summary': {
        version: 1,
        summary: text,
        generated_at: new Date(timestamp).toISOString(),
      },
    },
  });

afterEach(() => vi.restoreAllMocks());

it('reads aliased SDK timeline arrays once while retaining every summary candidate', () => {
  const ordinary = new MatrixEvent({ content: { msgtype: 'm.text', body: 'Reply' } });
  const read = vi.spyOn(ordinary, 'getContent');
  const events = [notice('$old', 'Old'), ordinary, notice('$new', 'New', 2000)];
  expect(
    getThreadSummaryInfosFromEventSources(events, events).map((info) => info?.summaryText)
  ).toEqual(['Old', 'New']);
  expect(read).toHaveBeenCalledTimes(1);
});

it('does not reparse unchanged summary metadata during repeated overview resolution', () => {
  const events = [notice('$old', 'Old'), notice('$new', 'New', 2000)];
  const parse = vi.spyOn(Date, 'parse');
  for (let refresh = 0; refresh < 5; refresh += 1) {
    expect(getLatestThreadSummaryInfoFromEventSources(events, events)?.summaryText).toBe('New');
  }
  expect(parse).toHaveBeenCalledTimes(2);
});

it('refreshes cached summary fields after metadata and body change in place', () => {
  const event = notice('$summary', 'Original');
  expect(getThreadSummaryEventInfo(event)?.summaryText).toBe('Original');
  const content = event.getContent();
  Object.assign(content['io.mindroom.thread_summary'], {
    summary: 'Human title',
    generated_at: new Date(2000).toISOString(),
    model: 'manual',
    message_count: 25,
  });
  expect(getThreadSummaryEventInfo(event)).toEqual({
    summaryText: 'Human title',
    generatedTs: 2000,
    eventTs: 1000,
    eventId: '$summary',
    isManual: true,
    messageCount: 25,
  });
  content['io.mindroom.thread_summary'].summary = undefined;
  content.body = 'Changed body';
  expect(getThreadSummaryEventInfo(event)?.summaryText).toBe('Changed body');
});

it('refreshes accepted server chronology without requiring different content', () => {
  const event = notice('$summary', 'Summary');
  event.setStatus(EventStatus.SENT);
  expect(getThreadSummaryEventInfo(event)?.eventTs).toBeUndefined();
  event.setStatus(null);
  event.event.origin_server_ts = 2000;
  expect(getThreadSummaryEventInfo(event)?.eventTs).toBe(2000);
  event.event.unsigned = {
    'm.relations': { 'm.replace': { event_id: '$edit', origin_server_ts: 3000 } },
  };
  expect(getThreadSummaryEventInfo(event)?.eventTs).toBe(3000);
});

it('refreshes an edited summary in a timeline whose array identity is unchanged', () => {
  const original = notice('$original', 'Original');
  const latest = notice('$latest', 'Later summary', 2000);
  const events = [original, latest];
  expect(getLatestThreadSummaryInfoFromEventSources(events)?.summaryText).toBe('Later summary');
  const edit = notice('$edit', 'Edited original', 3000);
  edit.event.content = { 'm.new_content': edit.getContent() };
  original.makeReplaced(edit);
  expect(getLatestThreadSummaryInfoFromEventSources(events)?.summaryText).toBe('Edited original');
  original.makeReplaced();
  expect(getLatestThreadSummaryInfoFromEventSources(events)?.summaryText).toBe('Later summary');
});

it('discovers late decryption and drops a redacted summary from an unchanged array', async () => {
  const clearContent = notice('$source', 'Decrypted summary', 2000).getContent();
  const encrypted = new MatrixEvent({
    event_id: '$encrypted',
    type: 'm.room.encrypted',
    origin_server_ts: 2000,
    content: { ciphertext: 'Encrypted' },
  });
  const events = [notice('$old', 'Older title'), encrypted];
  expect(getLatestThreadSummaryInfoFromEventSources(events)?.summaryText).toBe('Older title');
  const crypto: Pick<CryptoBackend, 'decryptEvent'> = {
    decryptEvent: async () => ({ clearEvent: { type: 'm.room.message', content: clearContent } }),
  };
  await encrypted.attemptDecryption(crypto as CryptoBackend);
  expect(getLatestThreadSummaryInfoFromEventSources(events)?.summaryText).toBe('Decrypted summary');
  const mx = createClient({ baseUrl: 'https://matrix.example', userId: '@reader:example' });
  encrypted.makeRedacted(
    new MatrixEvent({ type: 'm.room.redaction', content: {}, redacts: '$encrypted' }),
    new Room('!summary:example', mx, mx.getSafeUserId())
  );
  expect(getLatestThreadSummaryInfoFromEventSources(events)?.summaryText).toBe('Older title');
});
