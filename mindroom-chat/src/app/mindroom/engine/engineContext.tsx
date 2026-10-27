/**
 * CINNY-207 P3.1: React context wrapper for MindroomSyncEngine.
 *
 * The engine itself is framework-agnostic. This module exposes it to
 * the React tree so consumers (Commit 5 rewires the fetch controllers
 * onto engine.persist through this hook) don't have to prop-drill.
 * ClientRoot.tsx creates the engine, calls start(), then wraps the
 * ready content with `<MindroomSyncEngineProvider>` next to the
 * MatrixClientProvider.
 */

import React, { createContext, useContext } from 'react';
import type { MindroomSyncEngine } from './types';

const MindroomSyncEngineContext = createContext<MindroomSyncEngine | undefined>(undefined);

export type MindroomSyncEngineProviderProps = {
  engine: MindroomSyncEngine;
  children: React.ReactNode;
};

export const MindroomSyncEngineProvider = ({
  engine,
  children,
}: MindroomSyncEngineProviderProps): React.ReactElement => {
  return (
    <MindroomSyncEngineContext.Provider value={engine}>
      {children}
    </MindroomSyncEngineContext.Provider>
  );
};

export const useMindroomSyncEngine = (): MindroomSyncEngine => {
  const engine = useContext(MindroomSyncEngineContext);
  if (!engine) {
    throw new Error(
      'useMindroomSyncEngine must be used within a MindroomSyncEngineProvider (see ClientRoot.tsx)'
    );
  }
  return engine;
};

/**
 * Test/tolerant variant: returns undefined when no provider is
 * present. Useful for legacy tests during the P3 migration window
 * where the tree isn't wrapped yet.
 */
export const useMindroomSyncEngineOptional = (): MindroomSyncEngine | undefined => {
  return useContext(MindroomSyncEngineContext);
};
