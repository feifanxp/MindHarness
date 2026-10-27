import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { vi } from 'vitest';
import en from './app/locales/en.json';

// Component tests do not transform vanilla-extract files. Browser coverage
// exercises the real material recipe; unit tests only need its composed class.
vi.mock('./app/styles/Glass.css', () => ({
  glassShadow: '--glass-shadow',
  glassFloating: 'glass-floating',
  glassInheritTint: 'glass-inherit-tint',
  glassScrollPanel: 'glass-scroll-panel',
  glassFlat: 'glass-flat',
  glassOutline: 'glass-outline',
  glassDenseOverBackdrop: 'glass-dense-over-backdrop',
  glassSurface: () => 'glass-surface',
}));
vi.mock('./app/mindroom/messages/ThreadActivity.css', () => ({
  Activity: 'activity',
  Line: 'activity-line',
  Icon: {
    neutral: 'activity-icon',
    success: 'activity-icon-success',
    critical: 'activity-icon-critical',
    warning: 'activity-icon-warning',
  },
  Title: 'activity-title',
  Detail: 'activity-detail',
  Chevron: 'activity-chevron',
  Panel: 'activity-panel',
  Row: 'activity-row',
  RowBody: 'activity-row-body',
  RowName: 'activity-row-name',
  RowText: 'activity-row-text',
  Result: 'activity-result',
}));
vi.mock('./app/components/user-avatar/UserAvatar.css', () => ({ UserAvatar: 'user-avatar' }));
vi.mock('./app/components/glass/Surface.css', () => ({
  inheritSurface: 'surface-inherit',
}));
vi.mock('./app/mindroom/threads/RoomOverlay.css', () => ({
  Header: 'room-header',
  HeaderInThread: 'room-header-in-thread',
  Footer: 'room-footer',
  Following: 'room-following',
  Overview: 'room-overview',
  Scroll: 'room-scroll',
  Scrollbar: 'room-scrollbar',
  headerInset: 'var(--room-header-height, 0px)',
  footerInset: 'var(--room-footer-height, 0px)',
  topInset: '0px',
  controlsTopInset: '0px',
}));

// Existing component tests replace Folds primitives with focused doubles.
// Keep those doubles in place without requiring every factory to implement
// the polymorphic helper used only by the visual wrapper.
vi.mock('./app/components/glass/GlassPrimitives', async () => {
  const folds = await import('folds');
  const wrappers: Record<string, unknown> = {};
  (['Menu', 'MenuItem', 'Modal', 'Dialog', 'Header', 'IconButton', 'Chip'] as const).forEach(
    (name) => {
      Object.defineProperty(wrappers, name, {
        enumerable: true,
        get: () => folds[name],
      });
    }
  );
  Object.defineProperty(wrappers, 'Surface', {
    enumerable: true,
    get: () => folds.Box,
  });
  return wrappers;
});
vi.mock('./app/components/inset-scrollbar/InsetScrollbar.css', () => ({
  Viewport: 'inset-viewport',
  Track: 'inset-track',
  Thumb: 'inset-thumb',
}));

// Component tests use the real English catalog without browser detection or HTTP.
void i18next.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  initImmediate: false,
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

class StorageMock implements Storage {
  private values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const createStorageMock = (): Storage => new StorageMock();

if (typeof window !== 'undefined' && typeof window.localStorage?.clear !== 'function') {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: createStorageMock(),
  });
}
