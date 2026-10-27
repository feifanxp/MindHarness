import React from 'react';
import { createRoot } from 'react-dom/client';
import { createClient, MsgType } from 'matrix-js-sdk';
import { Provider } from 'jotai';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import '../../src/index.css';
import '../../src/app/i18n';
import { DarkTheme, LightTheme } from '../../src/app/hooks/useTheme';
import { applyThemeToDom } from '../../src/app/theme/themeBootstrap';
import { MatrixClientProvider } from '../../src/app/hooks/useMatrixClient';
import { SpecVersionsProvider } from '../../src/app/hooks/useSpecVersions';
import { MAudio } from '../../src/app/components/message/MsgTypeRenderers';
import {
  MATRIX_AUDIO_DETAILS_PROPERTY_NAME,
  MATRIX_VOICE_MESSAGE_PROPERTY_NAME,
} from '../../src/types/matrix/common';

const dark = new URLSearchParams(window.location.search).get('theme') === 'dark';
applyThemeToDom(dark ? DarkTheme : LightTheme);
document.body.style.cssText = `margin:24px; background:${dark ? '#1a1a1a' : '#fff'};`;

const content = {
  msgtype: MsgType.Audio,
  body: 'Interview with the design team.wav',
  url: 'mxc://fixture/audio',
  info: { mimetype: 'audio/wav', duration: 12000, size: 192044 },
};

createRoot(document.getElementById('root')!).render(
  <Provider>
    <MatrixClientProvider
      value={createClient({ baseUrl: window.location.origin, userId: '@fixture:localhost' })}
    >
      <SpecVersionsProvider value={{ versions: ['v1.10'] }}>
        <div
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 24 }}
        >
          {[false, true].map((voice) => (
            <section
              key={String(voice)}
              aria-label={voice ? 'Voice message' : 'Audio attachment'}
              style={{ display: 'inline-flex', maxWidth: '100%' }}
            >
              <MAudio
                content={
                  voice
                    ? {
                        ...content,
                        body: 'voice.wav',
                        [MATRIX_VOICE_MESSAGE_PROPERTY_NAME]: {},
                        [MATRIX_AUDIO_DETAILS_PROPERTY_NAME]: {
                          duration: 12000,
                          waveform: [80, 240, 600, 320, 880, 1024, 450, 200, 740, 550, 170, 80],
                        },
                      }
                    : content
                }
                renderAsFile={() => <div>Unsupported audio</div>}
              />
            </section>
          ))}
        </div>
      </SpecVersionsProvider>
    </MatrixClientProvider>
  </Provider>
);
