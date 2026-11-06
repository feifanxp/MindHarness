import React, { type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { color } from 'folds';
import 'folds/dist/style.css';
import '../../src/index.css';
import '../../src/projectWizard/discussionSpace.css';
import { LightTheme } from '../../src/app/hooks/useTheme';
import { applyThemeToDom } from '../../src/app/theme/themeBootstrap';
import { putSession } from '../../src/app/state/sessions';
import { RouterDebugger } from '../../src/projectWizard/RouterDebugger';

applyThemeToDom(LightTheme);
putSession({
  baseUrl: window.location.origin,
  userId: '@debug:fixture',
  accessToken: 'fixture-token',
  deviceId: 'fixture',
});
const theme = {
  '--discussion-background': color.Background.Container,
  '--discussion-surface': color.Surface.Container,
  '--discussion-text': color.Surface.OnContainer,
  '--discussion-muted': color.Secondary.Main,
  '--discussion-line': color.Surface.ContainerLine,
  '--discussion-accent': color.Primary.Main,
  '--discussion-danger': color.Critical.Main,
} as CSSProperties;

createRoot(document.getElementById('root')!).render(
  <main className="discussion-space" style={theme}>
    <div className="discussion-room">
      <header style={{ padding: 16 }}>Router 调试器 · 界面验证</header>
      <div className="discussion-live-layout">
        <div
          className="discussion-room-timeline"
          style={{ flexDirection: 'column', padding: 16, gap: 16 }}
        >
          <p>这是一段用于验证布局的示例讨论。</p>
          <p>请给出两个具体例子。</p>
          <textarea
            aria-label="示例聊天输入"
            placeholder="这里仍可继续输入消息"
            style={{ marginTop: 'auto', padding: 12, width: '100%' }}
          />
        </div>
        <RouterDebugger draftId="fixture" />
      </div>
    </div>
  </main>
);
