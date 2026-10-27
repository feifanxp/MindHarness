import React from 'react';
import { create } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { useThreadsSelected } from './useThreadsSelected';

function Probe({ onValue }: { onValue: (value: boolean) => void }) {
  onValue(useThreadsSelected());
  return null;
}

const readSelected = (path: string): boolean => {
  let selected = false;
  create(
    React.createElement(
      MemoryRouter,
      { initialEntries: [path] },
      React.createElement(Probe, {
        onValue: (value) => {
          selected = value;
        },
      })
    )
  );
  return selected;
};

describe('useThreadsSelected', () => {
  it('selects the top-level threads route', () => {
    expect(readSelected('/threads/')).toBe(true);
    expect(readSelected('/home/')).toBe(false);
  });
});
