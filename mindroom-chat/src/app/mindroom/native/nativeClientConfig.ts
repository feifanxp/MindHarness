import { Capacitor } from '@capacitor/core';

// Native config is a local bundled asset, so always read this app version's switches before
// mounting its router. A cached web config otherwise hides new switches until a second launch.
export const shouldUseCachedClientConfig = (): boolean => !Capacitor.isNativePlatform();
