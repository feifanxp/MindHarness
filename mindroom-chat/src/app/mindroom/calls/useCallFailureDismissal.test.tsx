import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import type { CallFailureNotice } from './useCallFailureNotice';
import { useCallFailureDismissal } from './useCallFailureDismissal';

let observed: ReturnType<typeof useCallFailureDismissal>;

function Probe({ joined, failure }: { joined: boolean; failure: CallFailureNotice }) {
  observed = useCallFailureDismissal(joined, failure);
  return null;
}

describe('useCallFailureDismissal', () => {
  it('shows a dismissed failure again after leaving and rejoining', () => {
    const failure = { eventId: '$failure', message: 'Voice call failed.' };
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(<Probe joined failure={failure} />);
    });
    expect(observed.visibleFailure).toEqual(failure);

    act(() => observed.dismissFailure());
    expect(observed.visibleFailure).toBeUndefined();

    act(() => renderer!.update(<Probe joined={false} failure={failure} />));
    act(() => renderer!.update(<Probe joined failure={failure} />));

    expect(observed.visibleFailure).toEqual(failure);
    act(() => renderer!.unmount());
  });
});
