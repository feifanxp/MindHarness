import React from 'react';
import { createRoot } from 'react-dom/client';
import { Menu, MenuItem } from '../../src/app/components/glass/GlassPrimitives';
import { useLiquidGlass } from '../../src/app/components/glass/liquid/useLiquidGlass';
import { LightTheme, DarkTheme } from '../../src/app/hooks/useTheme';
import { applyThemeToDom } from '../../src/app/theme/themeBootstrap';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';

const params = new URLSearchParams(window.location.search);
const dark = params.get('theme') === 'dark';
applyThemeToDom(dark ? DarkTheme : LightTheme);
document.body.style.margin = '0';

function Optics() {
  const lens = useLiquidGlass<HTMLDivElement>();
  return (
    <main
      style={{
        margin: 0,
        width: 600,
        height: 400,
        background: 'repeating-linear-gradient(90deg, #111 0 6px, #eee 6px 12px)',
      }}
    >
      <div
        data-testid="optical-lens"
        ref={lens}
        style={{
          position: 'absolute',
          left: 100,
          top: 80,
          width: 320,
          height: 220,
          borderRadius: 28,
          background: 'transparent',
          backdropFilter: 'var(--liquid-glass-filter, none)',
        }}
      />
    </main>
  );
}

function Showcase() {
  return (
    <main
      style={{
        position: 'relative',
        minHeight: '100vh',
        overflow: 'hidden',
        background: dark ? '#171a23' : '#eaece8',
        color: dark ? '#e6e8f1' : '#202636',
        fontFamily: 'InterVariable, sans-serif',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: '10% -5% auto 36%',
          height: 420,
          borderRadius: '50%',
          background: '#c4b3ef',
          transform: 'rotate(-24deg)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: '48% 40% -30% -15%',
          borderRadius: '50%',
          background: '#db704d',
          transform: 'rotate(-22deg)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: '7%',
          top: '16%',
          fontWeight: 750,
          fontSize: 'clamp(76px, 14vw, 184px)',
          lineHeight: 0.9,
          letterSpacing: '-0.07em',
        }}
      >
        WORK
        <br />
        IN
        <br />
        FLOW.
      </div>
      <div
        style={{ position: 'absolute', left: '7%', top: 28, fontSize: 12, letterSpacing: '0.15em' }}
      >
        MINDROOM / MATERIAL STUDY
      </div>
      <Menu
        data-testid="showcase-menu"
        style={{
          position: 'absolute',
          left: '46%',
          top: '24%',
          width: 'min(360px, 48vw)',
          padding: 12,
          borderRadius: 26,
        }}
      >
        <div style={{ padding: '18px 16px 22px', fontSize: 24, fontWeight: 600 }}>
          Room for ideas
        </div>
        <MenuItem size="400" radii="400">
          Start a conversation
        </MenuItem>
        <MenuItem size="400" radii="400">
          Browse your threads
        </MenuItem>
        <MenuItem size="400" radii="400">
          Bring the team together
        </MenuItem>
        <MenuItem size="400" radii="400">
          Find a little focus
        </MenuItem>
        <div style={{ padding: '22px 16px 14px', fontSize: 12 }}>
          A shared place to think clearly.
        </div>
      </Menu>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  params.has('optics') ? <Optics /> : <Showcase />
);
