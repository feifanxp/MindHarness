import { createContext, useContext } from 'react';

const SurfaceContext = createContext(false);

export const SurfaceProvider = SurfaceContext.Provider;

/** Whether layout children should reveal an enclosing material. */
export const useSurfaceContext = (): boolean => useContext(SurfaceContext);

const ScrollHeaderContext = createContext(false);
export const ScrollHeaderProvider = ScrollHeaderContext.Provider;
/** Scrolling titles need their own flat material, even inside another glass surface. */
export const useScrollHeaderContext = (): boolean => useContext(ScrollHeaderContext);
