import { useSyncExternalStore } from 'react';
import {
  SessionStore,
  StoredSession,
  getActiveSession,
  getSessionStore,
  listSessions,
  subscribeToSessionStore,
} from '../state/sessions';

export const useSessionStore = (): SessionStore =>
  useSyncExternalStore(subscribeToSessionStore, getSessionStore, getSessionStore);

export const useActiveSession = (): StoredSession | undefined =>
  useSyncExternalStore(subscribeToSessionStore, getActiveSession, getActiveSession);

export const useStoredSessions = (): StoredSession[] =>
  useSyncExternalStore(subscribeToSessionStore, listSessions, listSessions);
