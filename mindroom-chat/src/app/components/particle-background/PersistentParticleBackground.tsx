import React, {
  ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { MindRoomParticleBackground } from './MindRoomParticleBackground';
import * as css from './PersistentParticleBackground.css';

type AcquireParticleBackground = () => () => void;

const PersistentParticleBackgroundContext = React.createContext<
  AcquireParticleBackground | undefined
>(undefined);

export function PersistentParticleBackgroundProvider({ children }: { children: ReactNode }) {
  const requestCountRef = useRef(0);
  const mountedRef = useRef(false);
  const [active, setActive] = useState(false);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const acquire = useCallback<AcquireParticleBackground>(() => {
    requestCountRef.current += 1;
    setActive(true);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      requestCountRef.current = Math.max(0, requestCountRef.current - 1);

      // React removes the old loading surface before mounting its replacement.
      // Waiting until the commit finishes lets the replacement acquire this same
      // renderer instead of tearing down WebGL during a splash-to-splash handoff.
      queueMicrotask(() => {
        if (mountedRef.current && requestCountRef.current === 0) {
          setActive(false);
        }
      });
    };
  }, []);

  return (
    <PersistentParticleBackgroundContext.Provider value={acquire}>
      {active && (
        <div className={css.PersistentParticleBackground}>
          <MindRoomParticleBackground position="fixed" />
        </div>
      )}
      {children}
    </PersistentParticleBackgroundContext.Provider>
  );
}

type ParticleBackgroundSurfaceProps = {
  position?: 'absolute' | 'fixed';
};

export function ParticleBackgroundSurface({
  position = 'absolute',
}: ParticleBackgroundSurfaceProps) {
  const acquire = useContext(PersistentParticleBackgroundContext);

  useLayoutEffect(() => acquire?.(), [acquire]);

  if (acquire) return null;
  return <MindRoomParticleBackground position={position} />;
}

export function usePersistentParticleBackground(): boolean {
  return useContext(PersistentParticleBackgroundContext) !== undefined;
}
