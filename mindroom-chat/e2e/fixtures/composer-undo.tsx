import React from 'react';
import { createRoot } from 'react-dom/client';
import { configClass, varsClass } from 'folds';
import '@fontsource/inter/variable.css';
import 'folds/dist/style.css';
import '../../src/index.css';
import { lightTheme } from '../../src/colors.css';
import { CustomEditor, useEditor } from '../../src/app/components/editor';

document.documentElement.className = `${configClass} ${varsClass} ${lightTheme}`;

function Composer() {
  const editor = useEditor();
  return <CustomEditor editableName="RoomInput" editor={editor} placeholder="Send a message..." />;
}

createRoot(document.getElementById('root')!).render(
  <main style={{ padding: 24, maxWidth: 640 }}>
    <Composer />
  </main>
);
