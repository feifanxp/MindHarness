import { describe, expect, it } from 'vitest';
import { appFile, mindroomFile, repoFile, resolvedDependencies } from './architectureTestUtils';

const OWNERSHIP_EDGES = [
  {
    consumer: appFile('components/RenderMessageContent.tsx'),
    owner: mindroomFile('messages/renderMindroomMessageContent.tsx'),
  },
  {
    consumer: appFile('components/message/Reply.tsx'),
    owner: mindroomFile('messages/replyExtensions.tsx'),
  },
  {
    consumer: appFile('plugins/react-custom-html-parser.tsx'),
    owner: mindroomFile('html/customHtmlRenderers.tsx'),
  },
  {
    consumer: appFile('utils/room.ts'),
    owner: mindroomFile('messages/editResolution.ts'),
  },
  {
    consumer: appFile('features/settings/Settings.tsx'),
    owner: mindroomFile('settings/settingsExtensions.tsx'),
  },
  {
    consumer: appFile('features/settings/settingsMenu.ts'),
    owner: mindroomFile('settings/settingsMenuExtensions.ts'),
  },
  {
    consumer: appFile('features/settings/general/General.tsx'),
    owner: mindroomFile('settings/settingsExtensions.tsx'),
  },
  ...['home/Home.tsx', 'space/Space.tsx'].map((page) => ({
    consumer: appFile(`pages/client/${page}`),
    owner: mindroomFile('recent-threads/ThreadNavCategory.tsx'),
  })),
  ...['home/Home.tsx', 'direct/Direct.tsx', 'space/Space.tsx'].map((page) => ({
    consumer: appFile(`pages/client/${page}`),
    owner: mindroomFile('recent-threads/RecentlyOpenedNavCategory.tsx'),
  })),
  {
    consumer: appFile('pages/client/ClientInitStorageAtom.tsx'),
    owner: mindroomFile('recent-threads/recentlyOpenedCategory.ts'),
  },
  {
    consumer: appFile('pages/client/SidebarNav.tsx'),
    owner: mindroomFile('sidebar/MindroomTab.tsx'),
  },
  {
    consumer: appFile('pages/client/sidebar/SearchTab.tsx'),
    owner: mindroomFile('command-palette/MindroomCommandPaletteSidebarTab.tsx'),
  },
  {
    consumer: appFile('features/settings/notifications/SystemNotification.tsx'),
    owner: mindroomFile('notifications/SystemNotificationMindroomExtensions.tsx'),
  },
  {
    consumer: appFile('pages/client/ClientNonUIFeatures.tsx'),
    owner: mindroomFile('client/MindroomClientNonUIFeatures.tsx'),
  },
  {
    consumer: repoFile('src/client/initMatrix.ts'),
    owner: mindroomFile('matrix/matrixClientFactory.ts'),
  },
  {
    consumer: appFile('components/AuthFlowsLoader.tsx'),
    owner: mindroomFile('matrix/matrixClientFactory.ts'),
  },
  {
    consumer: appFile('pages/client/SyncStatus.tsx'),
    owner: mindroomFile('matrix/homeserverReachability.ts'),
  },
  ...[
    'pages/auth/AuthFooter.tsx',
    'pages/auth/AuthLayout.tsx',
    'pages/auth/SSOLogin.tsx',
    'pages/auth/login/Login.tsx',
    'pages/auth/login/PasswordLoginForm.tsx',
    'pages/auth/login/TokenLogin.tsx',
    'pages/auth/register/Register.tsx',
    'pages/auth/register/PasswordRegisterForm.tsx',
  ].map((consumer) => ({
    consumer: appFile(consumer),
    owner: mindroomFile('auth/authUi.ts'),
  })),
  ...[
    'pages/client/WelcomePage.tsx',
    'components/splash-screen/SplashScreen.tsx',
    'features/settings/about/About.tsx',
  ].map((consumer) => ({
    consumer: appFile(consumer),
    owner: mindroomFile('branding/clientBranding.ts'),
  })),
] as const;

describe('fork feature ownership edges', () => {
  it.each(OWNERSHIP_EDGES)('$consumer imports its fork-owned extension', ({ consumer, owner }) => {
    expect(resolvedDependencies(consumer)).toContain(owner);
  });

  it('owns cross-room thread indexing at persistent client scope', () => {
    const controller = mindroomFile('cross-room-threads/useCrossRoomThreadIndex.ts');
    const index = mindroomFile('cross-room-threads/crossRoomThreadIndex.ts');

    expect(resolvedDependencies(mindroomFile('client/MindroomClientNonUIFeatures.tsx'))).toContain(
      controller
    );
    [
      mindroomFile('recent-threads/ThreadNavCategory.tsx'),
      appFile('pages/client/threads/Threads.tsx'),
    ].forEach((consumer) => {
      expect(resolvedDependencies(consumer)).toContain(index);
      expect(resolvedDependencies(consumer)).not.toContain(controller);
    });
  });

  it('keeps mark-read behavior behind MindRoom notification components', () => {
    const consumers = [
      'features/room-nav/RoomNavItem.tsx',
      'pages/client/home/Home.tsx',
      'pages/client/direct/Direct.tsx',
      'pages/client/space/Space.tsx',
      'pages/client/sidebar/HomeTab.tsx',
      'pages/client/sidebar/DirectTab.tsx',
      'pages/client/sidebar/SpaceTabs.tsx',
      'pages/client/inbox/Notifications.tsx',
    ].map(appFile);
    const allowedComponents = new Set([
      mindroomFile('notifications/MindroomMarkRoomReadMenuItem.tsx'),
      mindroomFile('notifications/MindroomMarkRoomsReadMenuItem.tsx'),
      mindroomFile('notifications/MindroomMarkRoomReadChip.tsx'),
    ]);

    for (const consumer of consumers) {
      const dependencies = resolvedDependencies(consumer);
      expect(
        [...dependencies].some((dependency) => allowedComponents.has(dependency)),
        `${consumer} does not use a MindRoom mark-read component`
      ).toBe(true);
      expect(dependencies).not.toContain(mindroomFile('notifications/readReceipts.ts'));
    }
  });
});
