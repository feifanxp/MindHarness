import { createContext } from 'react';

/** A room's host can keep native message/thread navigation in its current workspace. */
export const RoomPathOverrideContext = createContext<
  ((roomId: string, eventId?: string) => string | undefined) | undefined
>(undefined);
