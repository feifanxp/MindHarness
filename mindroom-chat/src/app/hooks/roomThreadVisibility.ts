import { createContext, useContext } from 'react';

/** Hosts can present a room as one continuous conversation without exposing Matrix threads. */
export const HideRoomThreadsContext = createContext(false);

export const useHideRoomThreads = (): boolean => useContext(HideRoomThreadsContext);
