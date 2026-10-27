import React from 'react';
import { act, create } from 'react-test-renderer';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  discovery: {} as Record<string, unknown>,
  navigateRoomThread: vi.fn(),
  buildBugReport: vi.fn(async () => ({ reportedAt: '2026-10-03T12:00:00.000Z' })),
  ensureBugReportRoom: vi.fn(async () => ({ roomId: '!reports:example.com' })),
  sendBugReport: vi.fn(async () => ({ roomId: '!reports:example.com', threadRootId: '$summary' })),
  saveFile: vi.fn(async () => true),
}));

vi.mock('folds', () => ({
  as: (render: (props: object, ref: React.Ref<unknown>) => React.ReactNode) =>
    React.forwardRef((props, ref) => render(props, ref)),
  Icon: ({ src }: { src: string }) => <i data-icon={src} />,
  Icons: { Flag: 'flag' },
  MenuItem: React.forwardRef(
    (
      {
        children,
        after,
        ...props
      }: React.ButtonHTMLAttributes<HTMLButtonElement> & { after?: React.ReactNode },
      ref
    ) => (
      <button ref={ref} type="button" {...props}>
        {children}
        {after}
      </button>
    )
  ),
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock('../../features/room/message/styles.css', () => ({ MessageMenuItemText: 'text' }));
vi.mock('../../hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));
vi.mock('../../hooks/useAutoDiscoveryInfo', () => ({
  useAutoDiscoveryInfo: () => mocks.discovery,
}));
vi.mock('../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoomThread: mocks.navigateRoomThread }),
}));
vi.mock('../native/nativeFileSave', () => ({ saveFile: mocks.saveFile }));
vi.mock('./bugReportPayload', () => ({
  buildBugReport: mocks.buildBugReport,
  getBugReportFileName: () => 'report.json',
  serializeBugReport: () => new Blob(['{}']),
}));
vi.mock('./bugReportRoom', () => ({ ensureBugReportRoom: mocks.ensureBugReportRoom }));
vi.mock('./sendBugReport', () => ({ sendBugReport: mocks.sendBugReport }));

import { MessageBugReportItem } from './MessageBugReportItem';

const strings = {
  mindroomUi: {
    messages: {
      bugReport: {
        report: 'Report a bug',
        download: 'Download bug report',
        sending: 'Sending report…',
        failed: "Couldn't send the report. Try again.",
      },
    },
  },
};

const render = async (onClose = vi.fn()) => {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: strings } },
  });
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(
      <I18nextProvider i18n={i18n}>
        <MessageBugReportItem room={{} as never} mEvent={{} as never} onClose={onClose} />
      </I18nextProvider>
    );
  });
  return renderer;
};

const text = (renderer: ReturnType<typeof create>) =>
  renderer.root.findByType('button').findByType('span').props.children;

describe('MessageBugReportItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.discovery = {};
  });

  it('sends the report and opens its thread when admins are configured', async () => {
    mocks.discovery = { 'io.mindroom.bug_reports': { admins: ['@admin:example.com'] } };
    const onClose = vi.fn();
    const renderer = await render(onClose);
    expect(text(renderer)).toBe('Report a bug');
    await act(async () => {
      await renderer.root.findByType('button').props.onClick();
    });
    expect(mocks.ensureBugReportRoom).toHaveBeenCalledWith({}, ['@admin:example.com']);
    expect(mocks.sendBugReport).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(mocks.navigateRoomThread).toHaveBeenCalledWith('!reports:example.com', '$summary');
  });

  it('downloads the report when no admins are configured', async () => {
    const renderer = await render();
    expect(text(renderer)).toBe('Download bug report');
    await act(async () => {
      await renderer.root.findByType('button').props.onClick();
    });
    expect(mocks.saveFile).toHaveBeenCalledWith(expect.any(Blob), 'report.json');
    expect(mocks.ensureBugReportRoom).not.toHaveBeenCalled();
  });

  it('shows a retryable error when sending fails', async () => {
    mocks.discovery = { 'io.mindroom.bug_reports': { admins: ['@admin:example.com'] } };
    mocks.sendBugReport.mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onClose = vi.fn();
    const renderer = await render(onClose);
    await act(async () => {
      await renderer.root.findByType('button').props.onClick();
    });
    expect(text(renderer)).toBe("Couldn't send the report. Try again.");
    expect(renderer.root.findByType('button').props.disabled).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("uses its own icon, not the moderation Report item's warning icon", async () => {
    const renderer = await render();
    expect(renderer.root.findByType('i').props['data-icon']).toBe('flag');
  });

  it('does not offer a retry when opening the thread fails after a successful send', async () => {
    mocks.discovery = { 'io.mindroom.bug_reports': { admins: ['@admin:example.com'] } };
    mocks.navigateRoomThread.mockImplementationOnce(() => {
      throw new Error('navigation failed');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onClose = vi.fn();
    const renderer = await render(onClose);
    await act(async () => {
      await expect(renderer.root.findByType('button').props.onClick()).rejects.toThrow(
        'navigation failed'
      );
    });
    expect(mocks.sendBugReport).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
    expect(text(renderer)).not.toBe("Couldn't send the report. Try again.");
    expect(renderer.root.findByType('button').props.disabled).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});
