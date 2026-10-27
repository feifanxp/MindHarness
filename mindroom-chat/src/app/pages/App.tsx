import React from 'react';
import { Provider as JotaiProvider } from 'jotai';
import { OverlayContainerProvider, PopOutContainerProvider, TooltipContainerProvider } from 'folds';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ClientConfigLoader } from '../components/ClientConfigLoader';
import { ClientConfigProvider } from '../hooks/useClientConfig';
import { ConfigConfigError, ConfigConfigLoading } from './ConfigConfig';
import { FeatureCheck } from './FeatureCheck';
import { createRouter } from './Router';
import { ScreenSizeProvider, useScreenSize } from '../hooks/useScreenSize';
import { useCompositionEndTracking } from '../hooks/useComposingCheck';
import { useMobileKeyboardViewportFix } from '../hooks/useMobileKeyboardViewportFix';
import { appJotaiStore, setImperativeJotaiStore } from '../state/jotaiStore';
import { ReactQueryDevtoolsToggle } from '../components/ReactQueryDevtoolsToggle';
import { PersistentParticleBackgroundProvider } from '../components/particle-background';
import { MindroomThinkingDefinitions } from '../mindroom/messages/MindroomThinkingDefinitions';
import { portalContainer } from '../utils/portalOverlay';

const queryClient = new QueryClient();

function App() {
  const screenSize = useScreenSize();
  useCompositionEndTracking();
  useMobileKeyboardViewportFix();

  React.useEffect(() => setImperativeJotaiStore(appJotaiStore), []);

  return (
    <PersistentParticleBackgroundProvider>
      <MindroomThinkingDefinitions />
      <TooltipContainerProvider value={portalContainer}>
        <PopOutContainerProvider value={portalContainer}>
          <OverlayContainerProvider value={portalContainer}>
            <ScreenSizeProvider value={screenSize}>
              <FeatureCheck>
                <ClientConfigLoader
                  fallback={() => <ConfigConfigLoading />}
                  error={(err, retry, ignore, authenticate) => (
                    <ConfigConfigError
                      error={err}
                      retry={retry}
                      ignore={ignore}
                      authenticate={authenticate}
                    />
                  )}
                >
                  {(clientConfig) => (
                    <ClientConfigProvider value={clientConfig}>
                      <QueryClientProvider client={queryClient}>
                        <JotaiProvider store={appJotaiStore}>
                          <RouterProvider
                            router={createRouter(clientConfig, screenSize)}
                            fallbackElement={<ConfigConfigLoading />}
                          />
                        </JotaiProvider>
                        <ReactQueryDevtoolsToggle />
                      </QueryClientProvider>
                    </ClientConfigProvider>
                  )}
                </ClientConfigLoader>
              </FeatureCheck>
            </ScreenSizeProvider>
          </OverlayContainerProvider>
        </PopOutContainerProvider>
      </TooltipContainerProvider>
    </PersistentParticleBackgroundProvider>
  );
}

export default App;
