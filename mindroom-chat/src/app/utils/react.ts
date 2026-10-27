import type { MutableRefObject, Ref } from 'react';

export const assignElementRef = <T>(targetRef: Ref<T> | undefined, value: T | null) => {
  if (typeof targetRef === 'function') {
    targetRef(value);
    return;
  }

  if (targetRef) {
    const mutableRef = targetRef as MutableRefObject<T | null>;
    mutableRef.current = value;
  }
};
