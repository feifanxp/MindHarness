import React from 'react';
import { createRoot } from 'react-dom/client';
import { configClass, varsClass } from 'folds';
import 'folds/dist/style.css';
import '../../src/index.css';
import '../../src/app/i18n';
import { lightTheme } from '../../src/colors.css';
import { ImageViewer } from '../../src/app/components/image-viewer';

document.documentElement.className = `${configClass} ${varsClass} ${lightTheme}`;
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="skyblue"/><circle cx="300" cy="300" r="120" fill="tomato"/></svg>';

createRoot(document.getElementById('root')!).render(
  <div style={{ height: '100dvh' }}>
    <ImageViewer
      src={`data:image/svg+xml,${encodeURIComponent(svg)}`}
      alt="Test image"
      requestClose={() => undefined}
    />
  </div>
);
