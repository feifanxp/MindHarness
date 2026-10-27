import React from 'react';
import { act, create } from 'react-test-renderer';
import type { MatrixClient } from 'matrix-js-sdk';
import { expect, it } from 'vitest';
import { useRoomComputerState } from './useRoomComputerState';

it('clears control state and rejects stale callbacks when the service changes', () => {
  const mx = {} as MatrixClient;
  let state!: ReturnType<typeof useRoomComputerState>;
  function Probe({ apiUrl }: { apiUrl: string }) {
    state = useRoomComputerState({ mx, roomId: '!room:example.org', available: true, apiUrl });
    return null;
  }
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<Probe apiUrl="https://first.example" />);
  });
  act(() => {
    state.show('@mindroom_writer:example.org');
    state.reportInteraction({ locked: true });
  });
  expect(state.interaction.locked).toBe(true);
  const oldReport = state.reportInteraction;
  act(() => {
    renderer.update(<Probe apiUrl="https://second.example" />);
  });
  expect(state.open).toBe(false);
  expect(state.requestedAgent).toBeUndefined();
  expect(state.interaction.locked).toBe(false);
  act(() => {
    state.show('@mindroom_new:example.org');
    oldReport({ locked: true });
  });
  expect(state.open).toBe(true);
  expect(state.requestedAgent?.userId).toBe('@mindroom_new:example.org');
  expect(state.interaction.locked).toBe(false);
  act(() => {
    state.reportInteraction({ locked: true });
  });
  expect(state.interaction.locked).toBe(true);
  act(() => renderer.unmount());
});
