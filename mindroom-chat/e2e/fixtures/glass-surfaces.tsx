import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { createClient, MatrixEvent, MemoryStore, MsgType } from 'matrix-js-sdk';
import { Provider, createStore } from 'jotai';
import { AvatarFallback, Text, color, config } from 'folds';
import { Header, Menu, MenuItem, Modal } from '../../src/app/components/glass/GlassPrimitives';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import '../../src/index.css';
import '../../src/app/i18n';
import {
  ButterTheme,
  DarkTheme,
  LightTheme,
  MidnightTheme,
  SilverTheme,
} from '../../src/app/hooks/useTheme';
import { applyThemeToDom } from '../../src/app/theme/themeBootstrap';
import { MatrixClientProvider } from '../../src/app/hooks/useMatrixClient';
import { SpecVersionsProvider } from '../../src/app/hooks/useSpecVersions';
import { CustomEditor, useEditor } from '../../src/app/components/editor';
import { SidebarAvatar } from '../../src/app/components/sidebar';
import { MAudio } from '../../src/app/components/message/MsgTypeRenderers';
import { glassShadow } from '../../src/app/styles/Glass.css';
import { Page, PageHeader, PageNavHeader, PageRoot } from '../../src/app/components/page/Page';
import { NavCategoryHeader } from '../../src/app/components/nav/NavCategoryHeader';
import { ScreenSizeProvider, useScreenSize } from '../../src/app/hooks/useScreenSize';
import { RoomThreadOverview } from '../../src/app/mindroom/threads/RoomThreadOverview';
import type { ThreadFilterState } from '../../src/app/mindroom/threads/roomThreadOverviewModel';
import { mindroomAccountSettingsAtom } from '../../src/app/mindroom/settings/useMindroomAccountSettings';
import { Modal500 } from '../../src/app/components/Modal500';
import * as threadBannerCss from '../../src/app/mindroom/threads/ThreadContextBanner.css';
import { MessageGlass } from './MessageGlass';
import { DialogMenusGlass } from './DialogMenusGlass';
import { ChatControlsGlass } from './ChatControlsGlass';
import { AccountDataEvent } from '../../src/types/matrix/accountData';

const themes = {
  light: LightTheme,
  silver: SilverTheme,
  dark: DarkTheme,
  midnight: MidnightTheme,
  butter: ButterTheme,
};
const themeName = new URLSearchParams(window.location.search).get('theme') ?? 'light';
const theme = themes[themeName as keyof typeof themes] ?? LightTheme;
applyThemeToDom(theme);

const audioContent = {
  msgtype: MsgType.Audio,
  body: 'Design review.wav',
  url: 'mxc://fixture/glass-audio',
  info: { mimetype: 'audio/wav', duration: 12000, size: 192044 },
};

function Fixture() {
  const editor = useEditor();
  const screenSize = useScreenSize();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [threadAction, setThreadAction] = useState('No filter selected');
  const threadState: ThreadFilterState = {
    resolved: 'any',
    streaming: 'any',
    scheduled: 'any',
    unread: 'any',
    idle: 'any',
    sortBy: 'natural',
    sortDirection: 'desc',
    tags: new Map(),
    freeText: '',
    unsupportedQuery: '',
    statusMode: 'and',
  };

  return (
    <main
      data-glass-shadow-property={glassShadow.slice(4, -1)}
      style={{
        boxSizing: 'border-box',
        width: '100%',
        minHeight: '100vh',
        padding: 20,
        color: color.Surface.OnContainer,
        background: color.Surface.Container,
      }}
    >
      <button type="button" onClick={() => setSheetOpen(true)}>
        Open settings sheet
      </button>
      {sheetOpen && (
        <Modal500 requestClose={() => setSheetOpen(false)}>
          <div data-testid="settings-sheet" style={{ padding: 24 }}>
            <Text data-testid="settings-sheet-copy">Account preferences stay readable.</Text>
            <button type="button" onClick={() => setSheetOpen(false)}>
              Close settings sheet
            </button>
          </div>
        </Modal500>
      )}
      <div
        aria-hidden="true"
        style={{ display: 'grid', gap: 8, margin: '0 auto 18px', maxWidth: 680, opacity: 0.75 }}
      >
        <div>Alex: The compact layout is ready for review.</div>
        <div>Riley: Great, I will check the keyboard flow.</div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: 16,
          width: 'min(100%, 680px)',
          margin: '0 auto',
        }}
      >
        <Modal data-testid="glass-modal" size="500" style={{ width: '100%', maxWidth: '100%' }}>
          <Header data-testid="glass-header" variant="Critical" size="400">
            <Text data-testid="header-copy" size="H4">
              Review controls
            </Text>
          </Header>
          <div style={{ display: 'grid', gap: 12, padding: config.space.S400 }}>
            <Text data-testid="modal-copy" size="T300">
              Message tools
            </Text>
            <SidebarAvatar as="button" aria-label="Open workspace" outlined>
              <AvatarFallback>MR</AvatarFallback>
            </SidebarAvatar>
            <div data-testid="editor-host">
              <CustomEditor editor={editor} editableName="Message" placeholder="Send a message" />
            </div>
            <section
              data-testid="audio-host"
              aria-label="Audio attachment"
              style={{ minWidth: 0, maxWidth: '100%' }}
            >
              <MAudio content={audioContent} renderAsFile={() => <div>Unsupported audio</div>} />
            </section>
          </div>
        </Modal>

        <Menu data-testid="glass-menu" aria-label="Message actions">
          <MenuItem>
            <Text data-testid="menu-copy" size="B300">
              Reply
            </Text>
          </MenuItem>
          <MenuItem>Copy link</MenuItem>
        </Menu>

        <ScreenSizeProvider value={screenSize}>
          <Modal
            data-testid="settings-modal"
            size="500"
            style={{ width: '100%', maxWidth: '100%' }}
          >
            <PageNavHeader data-testid="settings-nav-header">Settings menu</PageNavHeader>
            <PageRoot nav={null}>
              <Page data-testid="settings-page">
                <PageHeader data-testid="settings-header">
                  <Text data-testid="settings-heading-copy" size="H4">
                    Settings
                  </Text>
                </PageHeader>
                <div style={{ padding: 16 }}>
                  <Text data-testid="settings-copy">Account preferences stay readable.</Text>
                  <button type="button" onClick={() => setMenuOpen(true)}>
                    Open nested menu
                  </button>
                  {menuOpen &&
                    createPortal(
                      <Menu
                        data-testid="settings-menu"
                        aria-label="Settings actions"
                        style={{ position: 'fixed', top: 20, left: 20, zIndex: 1000 }}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') setMenuOpen(false);
                        }}
                      >
                        <Header data-testid="settings-menu-header">Menu preferences</Header>
                        <MenuItem autoFocus onClick={() => setMenuOpen(false)}>
                          Close nested menu
                        </MenuItem>
                      </Menu>,
                      document.body
                    )}
                </div>
              </Page>
            </PageRoot>
          </Modal>
          <PageRoot nav={null}>
            <Page data-testid="standalone-page">
              <PageNavHeader data-testid="standalone-nav-header">Rooms</PageNavHeader>
              <NavCategoryHeader data-testid="plain-heading">Recently opened</NavCategoryHeader>
              <Text>Standalone page</Text>
            </Page>
          </PageRoot>
        </ScreenSizeProvider>

        <section data-testid="thread-overview">
          <RoomThreadOverview
            hasMindroomAgents
            threadCount={5}
            totalThreadCount={5}
            state={threadState}
            availableTags={['priority']}
            isThreadSortFrozen={false}
            viewMode="threaded"
            onToggle={() => {}}
            onSortDirectionChange={() => {}}
            onToggleThreadSortFreeze={() => {}}
            onReset={() => {}}
            onCycleTag={() => {}}
            onRemoveTag={() => {}}
            onAddTag={(tag) => setThreadAction(`Tag: ${tag}`)}
            onApplyPreset={(preset) => setThreadAction(`Preset: ${preset.id}`)}
            onSearchQueryChange={() => {}}
            onViewModeChange={() => {}}
          />
          <output>{threadAction}</output>
        </section>
        <section data-testid="thread-banner" className={threadBannerCss.Banner}>
          <Text size="L400">THREAD VIEW</Text>
          <Text>Review the glass surfaces</Text>
        </section>
      </div>
    </main>
  );
}

const store = createStore();
store.set(mindroomAccountSettingsAtom, { simpleMode: false, showCanvasesInSidebar: true });
const matrixClient = createClient({
  baseUrl: window.location.origin,
  userId: '@fixture:localhost',
  store: new MemoryStore(),
});
if (new URLSearchParams(window.location.search).get('viewer') === 'pack') {
  matrixClient.store.storeAccountDataEvents([
    new MatrixEvent({
      type: AccountDataEvent.PoniesUserEmotes,
      content: {
        pack: { display_name: 'Studio pack' },
        images: Object.fromEntries(
          Array.from({ length: 25 }, (_, index) => [
            `image-${index}`,
            { url: `mxc://fixture/pack-${index}` },
          ])
        ),
      },
    }),
  ]);
}

createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <MatrixClientProvider value={matrixClient}>
      <SpecVersionsProvider value={{ versions: ['v1.10'] }}>
        {new URLSearchParams(window.location.search).has('menus') ? (
          <DialogMenusGlass />
        ) : new URLSearchParams(window.location.search).has('controls') ? (
          <ChatControlsGlass />
        ) : new URLSearchParams(window.location.search).has('messages') ? (
          <MessageGlass />
        ) : (
          <Fixture />
        )}
      </SpecVersionsProvider>
    </MatrixClientProvider>
  </Provider>
);
