import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { RelationsEvent } from 'matrix-js-sdk/lib/models/relations';
import { useRelations } from './useRelations';

class MockRelations<T> {
  private listeners = new Map<string, Set<() => void>>();

  constructor(private value: T) {}

  setValue(nextValue: T) {
    this.value = nextValue;
  }

  readValue(): T {
    return this.value;
  }

  on(event: string, listener: () => void) {
    const current = this.listeners.get(event) ?? new Set<() => void>();
    current.add(listener);
    this.listeners.set(event, current);
  }

  removeListener(event: string, listener: () => void) {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string) {
    this.listeners.get(event)?.forEach((listener) => listener());
  }
}

function HookHarness({
  relations,
  getRelations,
}: {
  relations: MockRelations<string[]>;
  getRelations: (relations: MockRelations<string[]>) => string[];
}) {
  const data = useRelations(relations as never, getRelations as never);
  return React.createElement(React.Fragment, null, JSON.stringify(data));
}

describe('useRelations', () => {
  it('refreshes when the relations object identity changes', () => {
    const firstRelations = new MockRelations(['👍']);
    const secondRelations = new MockRelations([]);
    const getRelations = vi.fn((relations: MockRelations<string[]>) => relations.readValue());

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        React.createElement(HookHarness, { relations: firstRelations, getRelations })
      );
    });

    expect(renderer.toJSON()).toBe('["👍"]');

    act(() => {
      renderer.update(React.createElement(HookHarness, { relations: secondRelations, getRelations }));
    });

    expect(renderer.toJSON()).toBe('[]');
  });

  it('refreshes on relation add/remove/redaction events', () => {
    const relations = new MockRelations(['👍']);
    const getRelations = (currentRelations: MockRelations<string[]>) => currentRelations.readValue();

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(React.createElement(HookHarness, { relations, getRelations }));
    });

    expect(renderer.toJSON()).toBe('["👍"]');

    act(() => {
      relations.setValue([]);
      relations.emit(RelationsEvent.Redaction);
    });

    expect(renderer.toJSON()).toBe('[]');

    act(() => {
      relations.setValue(['🔥']);
      relations.emit(RelationsEvent.Add);
    });

    expect(renderer.toJSON()).toBe('["🔥"]');

    act(() => {
      relations.setValue([]);
      relations.emit(RelationsEvent.Remove);
    });

    expect(renderer.toJSON()).toBe('[]');
  });
});
