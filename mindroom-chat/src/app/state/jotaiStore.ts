import { createStore, getDefaultStore } from 'jotai';

type Store = ReturnType<typeof createStore>;

export const appJotaiStore = createStore();

let imperativeJotaiStore: Store | undefined;

export const getImperativeJotaiStore = (): Store => imperativeJotaiStore ?? getDefaultStore();

export const setImperativeJotaiStore = (store: Store) => {
  imperativeJotaiStore = store;

  return () => {
    if (imperativeJotaiStore === store) {
      imperativeJotaiStore = undefined;
    }
  };
};
