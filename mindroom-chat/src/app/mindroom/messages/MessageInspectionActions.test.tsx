import React from 'react';
import { act, create } from 'react-test-renderer';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { MessageSourceCodeItem } from './MessageInspectionActions';

vi.mock('folds', () => ({
  as: (render: (props: object, ref: React.Ref<unknown>) => React.ReactNode) =>
    React.forwardRef((props, ref) => render(props, ref)),
  Icon: () => null,
  Icons: { BlockCode: 'code', CheckTwice: 'read' },
  MenuItem: React.forwardRef(
    ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>, ref) => (
      <button ref={ref} type="button" {...props}>
        {children}
      </button>
    )
  ),
  Modal: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Overlay: ({ open, children }: { open: boolean; children?: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  OverlayBackdrop: () => null,
  OverlayCenter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../../components/text-viewer', () => ({
  TextViewer: ({ name }: { name: string }) => <div data-viewer-name={name} />,
}));
vi.mock('../../components/event-readers', () => ({ EventReaders: () => null }));
vi.mock('../../features/room/message/styles.css', () => ({ MessageMenuItemText: 'text' }));

describe('MessageSourceCodeItem', () => {
  it('updates the open viewer title after a language change', async () => {
    const language = createInstance();
    await language.init({
      lng: 'en',
      fallbackLng: 'en',
      react: { useSuspense: false },
      resources: {
        en: { translation: { sharedUi: { welcomePage: { sourceCode: 'Source Code' } } } },
        es: { translation: { sharedUi: { welcomePage: { sourceCode: 'Código fuente' } } } },
      },
    });
    const event = {
      event: { type: 'm.room.message', content: {} },
      getId: () => '$event',
      getType: () => 'm.room.message',
      isEncrypted: () => false,
      replacingEvent: () => undefined,
    };
    const room = { getTimelineForEvent: () => undefined };
    const renderer = create(
      <I18nextProvider i18n={language}>
        <MessageSourceCodeItem room={room as never} mEvent={event as never} />
      </I18nextProvider>
    );

    act(() => renderer.root.findByType('button').props.onClick());
    expect(renderer.root.findByProps({ 'data-viewer-name': 'Source Code' })).toBeDefined();
    await act(async () => {
      await language.changeLanguage('es');
    });
    expect(renderer.root.findByProps({ 'data-viewer-name': 'Código fuente' })).toBeDefined();
  });
});
