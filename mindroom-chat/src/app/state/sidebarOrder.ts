import { WritableAtom, atom } from 'jotai';
import produce from 'immer';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from './utils/atomWithLocalStorage';

export type SpaceOrderState = string[];
export type RoomOrderBySpaceState = Record<string, string[]>;

export type SpaceOrderAction =
  | {
      type: 'REORDER';
      order: string[];
    }
  | {
      type: 'REMOVE';
      id: string;
    };

export type RoomOrderAction =
  | {
      type: 'REORDER';
      parentSpaceId: string;
      order: string[];
    }
  | {
      type: 'REMOVE';
      parentSpaceId: string;
      roomId: string;
    }
  | {
      type: 'REMOVE_SPACE';
      parentSpaceId: string;
    };

export type SpaceOrderAtom = WritableAtom<SpaceOrderState, [SpaceOrderAction], undefined>;
export type RoomOrderBySpaceAtom = WritableAtom<
  RoomOrderBySpaceState,
  [RoomOrderAction],
  undefined
>;

export const SPACE_ORDER_STORAGE_KEY_PREFIX = 'mindroom.sidebar.spaceOrder:';
export const ROOM_ORDER_STORAGE_KEY_PREFIX = 'mindroom.sidebar.roomOrderBySpace:';

const uniqueStrings = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value.filter((id): id is string => {
    if (typeof id !== 'string' || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

const readStringArray = (key: string): string[] => uniqueStrings(getLocalStorageItem<unknown>(key, []));

const writeStringArray = (key: string, value: string[]) => {
  setLocalStorageItem(key, uniqueStrings(value));
};

const readRoomOrderBySpace = (key: string): RoomOrderBySpaceState => {
  const value = getLocalStorageItem<unknown>(key, {});
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.entries(value).reduce<RoomOrderBySpaceState>((orderBySpace, [spaceId, order]) => {
    const sanitizedOrder = uniqueStrings(order);
    if (sanitizedOrder.length > 0) orderBySpace[spaceId] = sanitizedOrder;
    return orderBySpace;
  }, {});
};

const writeRoomOrderBySpace = (key: string, value: RoomOrderBySpaceState) => {
  const sanitized = Object.entries(value).reduce<RoomOrderBySpaceState>(
    (orderBySpace, [spaceId, order]) => {
      const sanitizedOrder = uniqueStrings(order);
      if (sanitizedOrder.length > 0) orderBySpace[spaceId] = sanitizedOrder;
      return orderBySpace;
    },
    {}
  );

  setLocalStorageItem(key, sanitized);
};

export const makeSpaceOrderAtom = (userId: string): SpaceOrderAtom => {
  const storeKey = `${SPACE_ORDER_STORAGE_KEY_PREFIX}${userId}`;
  const baseSpaceOrderAtom = atomWithLocalStorage<SpaceOrderState>(
    storeKey,
    readStringArray,
    writeStringArray
  );

  return atom<SpaceOrderState, [SpaceOrderAction], undefined>(
    (get) => get(baseSpaceOrderAtom),
    (get, set, action) => {
      if (action.type === 'REORDER') {
        set(baseSpaceOrderAtom, uniqueStrings(action.order));
        return;
      }

      if (action.type === 'REMOVE') {
        set(
          baseSpaceOrderAtom,
          produce(get(baseSpaceOrderAtom), (draft) => {
            const index = draft.indexOf(action.id);
            if (index >= 0) draft.splice(index, 1);
          })
        );
      }
    }
  );
};

export const makeRoomOrderBySpaceAtom = (userId: string): RoomOrderBySpaceAtom => {
  const storeKey = `${ROOM_ORDER_STORAGE_KEY_PREFIX}${userId}`;
  const baseRoomOrderBySpaceAtom = atomWithLocalStorage<RoomOrderBySpaceState>(
    storeKey,
    readRoomOrderBySpace,
    writeRoomOrderBySpace
  );

  return atom<RoomOrderBySpaceState, [RoomOrderAction], undefined>(
    (get) => get(baseRoomOrderBySpaceAtom),
    (get, set, action) => {
      if (action.type === 'REORDER') {
        set(
          baseRoomOrderBySpaceAtom,
          produce(get(baseRoomOrderBySpaceAtom), (draft) => {
            const order = uniqueStrings(action.order);
            if (order.length === 0) {
              delete draft[action.parentSpaceId];
              return;
            }
            draft[action.parentSpaceId] = order;
          })
        );
        return;
      }

      if (action.type === 'REMOVE') {
        set(
          baseRoomOrderBySpaceAtom,
          produce(get(baseRoomOrderBySpaceAtom), (draft) => {
            const order = draft[action.parentSpaceId];
            if (!order) return;

            const index = order.indexOf(action.roomId);
            if (index >= 0) order.splice(index, 1);
            if (order.length === 0) delete draft[action.parentSpaceId];
          })
        );
        return;
      }

      if (action.type === 'REMOVE_SPACE') {
        set(
          baseRoomOrderBySpaceAtom,
          produce(get(baseRoomOrderBySpaceAtom), (draft) => {
            delete draft[action.parentSpaceId];
          })
        );
      }
    }
  );
};
