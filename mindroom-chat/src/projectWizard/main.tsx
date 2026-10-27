import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/variable.css';
import ProjectWizard from './ProjectWizard';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ProjectWizard />
  </React.StrictMode>
);
