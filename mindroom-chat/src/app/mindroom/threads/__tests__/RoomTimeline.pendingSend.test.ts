import { EventStatus } from 'matrix-js-sdk';
import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  makeEvent,
  makeRoom,
} from '../test-utils/RoomTimeline.test.shared';

describe('RoomTimeline pending-send wiring', () => {
  it('passes local-echo status into rendered message content and failed-send actions', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const { FailedSendActions } = await import('../../messages/FailedSendActions');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const pendingEvent = makeEvent('$pending', { content: { body: 'pending' } }) as ReturnType<
      typeof makeEvent
    > & { status?: EventStatus };
    pendingEvent.status = EventStatus.SENDING;
    const pendingEdit = makeEvent('$pending-edit', {
      content: { body: 'pending edit' },
    }) as ReturnType<typeof makeEvent> & { status?: EventStatus };
    pendingEdit.status = EventStatus.SENDING;
    const editedBaseEvent = makeEvent('$edited-base', {
      content: { body: 'original' },
    }) as ReturnType<typeof makeEvent> & { __editedEvent?: typeof pendingEdit };
    editedBaseEvent.__editedEvent = pendingEdit;
    const failedEvent = makeEvent('$failed', { content: { body: 'failed' } }) as ReturnType<
      typeof makeEvent
    > & { status?: EventStatus };
    failedEvent.status = EventStatus.NOT_SENT;
    const failedEdit = makeEvent('$failed-edit', {
      content: { body: 'failed edit' },
    }) as ReturnType<typeof makeEvent> & { status?: EventStatus };
    failedEdit.status = EventStatus.NOT_SENT;
    const failedEditBase = makeEvent('$failed-edit-base', {
      content: { body: 'original' },
    }) as ReturnType<typeof makeEvent> & { __editedEvent?: typeof failedEdit };
    failedEditBase.__editedEvent = failedEdit;
    const confirmedEvent = makeEvent('$confirmed', { content: { body: 'confirmed' } });
    const room = makeRoom({
      liveEvents: [pendingEvent, editedBaseEvent, failedEvent, failedEditBase, confirmedEvent],
    });

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(React.createElement(ControlledRoomTimeline, { room }));
      await flushAsyncWork(1);
    });

    const messageContent = renderer!.root
      .findAll(
        (node) =>
          typeof node.props.getContent === 'function' && typeof node.props.pendingSend === 'boolean'
      )
      .map((node) => ({
        body: node.props.getContent().body,
        pendingSend: node.props.pendingSend,
        failedSend: node.props.failedSend,
      }));

    expect(messageContent).toEqual(
      expect.arrayContaining([
        { body: 'pending', pendingSend: true, failedSend: false },
        { body: 'pending edit', pendingSend: true, failedSend: false },
        { body: 'failed', pendingSend: false, failedSend: true },
        { body: 'failed edit', pendingSend: false, failedSend: true },
        { body: 'confirmed', pendingSend: false, failedSend: false },
      ])
    );
    // Only failed sends offer Retry and Delete, aimed at the event that failed.
    expect(renderer!.root.findAllByType(FailedSendActions).map((node) => node.props.event)).toEqual(
      [failedEvent, failedEdit]
    );
  });
});
