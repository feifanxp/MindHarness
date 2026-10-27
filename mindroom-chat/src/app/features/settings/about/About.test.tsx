// @vitest-environment jsdom

import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { About } from './About';

const mocks = vi.hoisted(() => ({
  isNativeIOS: vi.fn(),
  getFlightRecorderStatus: vi.fn(),
  buildDiagnosticsExport: vi.fn(),
  getDeepTraceEnabled: vi.fn(),
  getDeepTraceRuntimeStatus: vi.fn(),
  setDeepTraceEnabled: vi.fn(),
  subscribeDeepTraceStatus: vi.fn(),
  clearDeepTrace: vi.fn(),
  saveFile: vi.fn(),
}));

vi.mock('folds', () => ({
  Box: ({ children, as = 'div' }: { children?: React.ReactNode; as?: string }) =>
    React.createElement(as, null, children),
  Scroll: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('span', null, children),
  Button: ({
    children,
    before,
    ...props
  }: {
    children?: React.ReactNode;
    before?: React.ReactNode;
    [key: string]: unknown;
  }) => React.createElement('button', props, before, children),
  IconButton: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('button', props, children),
  Icon: () => null,
  Icons: { Code: 'code', Cross: 'cross', Heart: 'heart' },
  Spinner: () => React.createElement('i'),
  Switch: ({
    value,
    onChange,
    disabled,
  }: {
    value: boolean;
    onChange: (value: boolean) => void;
    disabled?: boolean;
  }) =>
    React.createElement('input', {
      type: 'checkbox',
      checked: value,
      disabled,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.checked),
    }),
  config: { space: { S400: '1rem' } },
  toRem: (value: number) => `${value / 16}rem`,
}));

vi.mock('../../../components/page', () => ({
  PageScroll: ({ header, children }: React.PropsWithChildren<{ header?: React.ReactNode }>) =>
    React.createElement('section', null, header, children),
  Page: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('main', null, children),
  PageContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
  PageHeader: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('header', null, children),
}));

vi.mock('../../../components/sequence-card', () => ({
  SequenceCard: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../../../components/setting-tile', () => ({
  SettingTile: ({
    title,
    description,
    after,
  }: {
    title: string;
    description: string;
    after?: React.ReactNode;
  }) =>
    React.createElement(
      'section',
      { 'data-setting-title': title, 'data-description': description },
      after
    ),
}));

vi.mock('../styles.css', () => ({
  SequenceCardStyle: 'SequenceCardStyle',
}));

vi.mock('../../../../client/initMatrix', () => ({
  clearAllCacheAndReload: vi.fn(),
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({}),
}));

vi.mock('../../../hooks/useClientConfig', () => ({
  useClientConfig: () => ({ welcome: undefined }),
}));

vi.mock('../../../mindroom/branding/clientBranding', () => ({
  MINDROOM_CLIENT_BRANDING: {
    appName: 'MindRoom',
    logoAlt: 'MindRoom',
    logoSrc: 'logo.svg',
    sourceUrl: 'https://example.test/source',
  },
  getMindroomWelcomePageContent: () => ({ subtitle: 'Chat' }),
}));

vi.mock('../../../mindroom/native/nativeSso', () => ({
  isNativeIOS: mocks.isNativeIOS,
}));

vi.mock('../../../mindroom/native/nativeFileSave', () => ({
  saveFile: mocks.saveFile,
}));

vi.mock('../../../mindroom/diagnostics/flightRecorder', () => ({
  getFlightRecorderStatus: mocks.getFlightRecorderStatus,
}));

vi.mock('../../../mindroom/diagnostics/deepTrace', () => ({
  getDeepTraceEnabled: mocks.getDeepTraceEnabled,
  getDeepTraceRuntimeStatus: mocks.getDeepTraceRuntimeStatus,
  setDeepTraceEnabled: mocks.setDeepTraceEnabled,
  subscribeDeepTraceStatus: mocks.subscribeDeepTraceStatus,
  clearDeepTrace: mocks.clearDeepTrace,
}));

vi.mock('../../../mindroom/diagnostics/diagnosticsExport', () => ({
  buildDiagnosticsExport: mocks.buildDiagnosticsExport,
}));

vi.mock('../../../../appVersion', () => ({
  APP_RELEASE_VERSION: 'v4.12.6-mindroom.180',
}));

const diagnosticsTile = (renderer: ReactTestRenderer): ReactTestInstance =>
  renderer.root.findByProps({ 'data-setting-title': 'On-device diagnostics' });

const diagnosticsButton = (renderer: ReactTestRenderer): ReactTestInstance =>
  diagnosticsTile(renderer).findByType('button');

const deepTraceTile = (renderer: ReactTestRenderer): ReactTestInstance =>
  renderer.root.findByProps({ 'data-setting-title': 'Deep diagnostic tracing' });

const deepTraceSwitch = (renderer: ReactTestRenderer): ReactTestInstance =>
  deepTraceTile(renderer).findByType('input');

describe('About diagnostics export', () => {
  let deepTraceStatusListener: ((status: string) => void) | undefined;
  let deepTracePreference = false;
  let deepTraceRuntimeStatus = 'disabled';

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isNativeIOS.mockReturnValue(true);
    mocks.getFlightRecorderStatus.mockReturnValue('none');
    deepTracePreference = false;
    deepTraceRuntimeStatus = 'disabled';
    mocks.getDeepTraceEnabled.mockImplementation(() => deepTracePreference);
    mocks.getDeepTraceRuntimeStatus.mockImplementation(() => deepTraceRuntimeStatus);
    deepTraceStatusListener = undefined;
    mocks.setDeepTraceEnabled.mockImplementation(async (enabled: boolean) => {
      deepTracePreference = enabled;
      deepTraceRuntimeStatus = enabled ? 'recording' : 'disabled';
      deepTraceStatusListener?.(deepTraceRuntimeStatus);
      return true;
    });
    mocks.subscribeDeepTraceStatus.mockImplementation((listener: (status: string) => void) => {
      deepTraceStatusListener = listener;
      listener(deepTraceRuntimeStatus);
      return () => {
        if (deepTraceStatusListener === listener) deepTraceStatusListener = undefined;
      };
    });
    mocks.clearDeepTrace.mockResolvedValue(undefined);
    mocks.buildDiagnosticsExport.mockResolvedValue({
      blob: new Blob(['{}'], { type: 'application/json' }),
      fileName: 'mindroom-diagnostics-test.json',
    });
    mocks.saveFile.mockResolvedValue(true);
  });

  it.each([
    ['unexpected', 'Previous session ended unexpectedly; the cause is unknown.'],
    ['none', 'No unexpected session retained.'],
    ['unavailable', 'Diagnostics storage unavailable.'],
  ])('renders the %s status', (status, description) => {
    mocks.getFlightRecorderStatus.mockReturnValue(status);
    const renderer = create(<About requestClose={vi.fn()} />);

    expect(diagnosticsTile(renderer).props['data-description']).toBe(description);
    renderer.unmount();
  });

  it('shows the release version the client was built from', () => {
    const renderer = create(<About requestClose={vi.fn()} />);

    expect(
      renderer.root
        .findAllByType('span')
        .some((text) => text.children[0] === 'v4.12.6-mindroom.180')
    ).toBe(true);
    renderer.unmount();
  });

  it('does not render diagnostics outside native iOS', () => {
    mocks.isNativeIOS.mockReturnValue(false);
    const renderer = create(<About requestClose={vi.fn()} />);

    expect(
      renderer.root.findAllByProps({ 'data-setting-title': 'On-device diagnostics' })
    ).toHaveLength(0);
    expect(
      renderer.root.findAllByProps({ 'data-setting-title': 'Deep diagnostic tracing' })
    ).toHaveLength(0);
    renderer.unmount();
  });

  it('allows only one native save flow at a time', async () => {
    let resolveSave: ((saved: boolean) => void) | undefined;
    const savePending = new Promise<boolean>((resolve) => {
      resolveSave = resolve;
    });
    mocks.saveFile.mockReturnValue(savePending);
    const renderer = create(<About requestClose={vi.fn()} />);

    act(() => {
      void diagnosticsButton(renderer).props.onClick();
    });
    expect(diagnosticsButton(renderer).props.disabled).toBe(true);
    await act(async () => {
      await diagnosticsButton(renderer).props.onClick();
    });

    expect(mocks.buildDiagnosticsExport).toHaveBeenCalledOnce();
    expect(mocks.saveFile).toHaveBeenCalledOnce();

    await act(async () => {
      resolveSave?.(true);
      await savePending;
    });
    expect(diagnosticsButton(renderer).props.disabled).toBe(false);
    renderer.unmount();
  });

  it('shows an export error and clears it when a retry starts', async () => {
    mocks.saveFile.mockRejectedValueOnce(new Error('save failed')).mockResolvedValueOnce(true);
    const renderer = create(<About requestClose={vi.fn()} />);

    await act(async () => {
      await diagnosticsButton(renderer).props.onClick();
    });
    expect(diagnosticsTile(renderer).props['data-description']).toContain('Export failed.');

    await act(async () => {
      await diagnosticsButton(renderer).props.onClick();
    });
    expect(diagnosticsTile(renderer).props['data-description']).toBe(
      'No unexpected session retained.'
    );
    renderer.unmount();
  });

  it('does not offer a retry when unavailable diagnostics cannot be read', async () => {
    mocks.getFlightRecorderStatus.mockReturnValue('unavailable');
    mocks.buildDiagnosticsExport.mockRejectedValue(new Error('Diagnostics storage unavailable'));
    const renderer = create(<About requestClose={vi.fn()} />);

    await act(async () => {
      await diagnosticsButton(renderer).props.onClick();
    });

    expect(diagnosticsTile(renderer).props['data-description']).toBe(
      'Diagnostics storage unavailable.'
    );
    expect(diagnosticsButton(renderer).props.disabled).toBe(false);
    renderer.unmount();
  });

  it('treats native picker cancellation as neither success nor failure', async () => {
    mocks.saveFile.mockResolvedValue(false);
    const renderer = create(<About requestClose={vi.fn()} />);

    await act(async () => {
      await diagnosticsButton(renderer).props.onClick();
    });

    expect(diagnosticsButton(renderer).props.disabled).toBe(false);
    expect(diagnosticsTile(renderer).props['data-description']).toBe(
      'No unexpected session retained.'
    );
    expect(diagnosticsButton(renderer).findByType('span').children.join('')).toBe(
      'Export diagnostics'
    );
    renderer.unmount();
  });

  it('enables and disables deep tracing through the device-local switch', async () => {
    const renderer = create(<About requestClose={vi.fn()} />);

    await act(async () => {
      deepTraceSwitch(renderer).props.onChange({ target: { checked: true } });
      await Promise.resolve();
    });
    expect(mocks.setDeepTraceEnabled).toHaveBeenLastCalledWith(true);
    expect(deepTraceSwitch(renderer).props.checked).toBe(true);
    expect(deepTraceTile(renderer).props['data-description']).toContain('Recording');

    await act(async () => {
      deepTraceSwitch(renderer).props.onChange({ target: { checked: false } });
      await Promise.resolve();
    });
    expect(mocks.setDeepTraceEnabled).toHaveBeenLastCalledWith(false);
    expect(deepTraceSwitch(renderer).props.checked).toBe(false);
    renderer.unmount();
  });

  it('keeps the switch unchanged and reports unavailable trace storage when persistence fails', async () => {
    mocks.setDeepTraceEnabled.mockResolvedValue(false);
    const renderer = create(<About requestClose={vi.fn()} />);

    await act(async () => {
      deepTraceSwitch(renderer).props.onChange({ target: { checked: true } });
      await Promise.resolve();
    });

    expect(deepTraceSwitch(renderer).props.checked).toBe(false);
    expect(deepTraceTile(renderer).props['data-description']).toContain(
      'Trace storage unavailable.'
    );
    renderer.unmount();
  });

  it('keeps newly saved trace intent when runtime activation fails', async () => {
    mocks.setDeepTraceEnabled.mockImplementation(async (enabled: boolean) => {
      if (!enabled) return true;
      deepTracePreference = true;
      deepTraceRuntimeStatus = 'unavailable';
      deepTraceStatusListener?.('unavailable');
      return false;
    });
    const renderer = create(<About requestClose={vi.fn()} />);

    await act(async () => {
      deepTraceSwitch(renderer).props.onChange({ target: { checked: true } });
      await Promise.resolve();
    });

    expect(deepTraceSwitch(renderer).props.checked).toBe(true);
    expect(deepTraceTile(renderer).props['data-description']).toContain(
      'Enabled, but trace storage is currently unavailable.'
    );
    expect(deepTraceTile(renderer).props['data-description']).not.toContain('Recording');
    renderer.unmount();
  });

  it('keeps saved trace intent while reporting a background storage failure', () => {
    deepTracePreference = true;
    deepTraceRuntimeStatus = 'recording';
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<About requestClose={vi.fn()} />);
    });

    act(() => {
      deepTraceStatusListener?.('unavailable');
    });

    expect(deepTraceSwitch(renderer).props.checked).toBe(true);
    expect(deepTraceTile(renderer).props['data-description']).toContain(
      'Enabled, but trace storage is currently unavailable.'
    );
    expect(deepTraceTile(renderer).props['data-description']).not.toContain('Recording');
    renderer.unmount();
  });

  it('keeps recording enabled and explains memory-only retention after storage failure', () => {
    deepTracePreference = true;
    deepTraceRuntimeStatus = 'recording';
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<About requestClose={vi.fn()} />);
    });
    act(() => {
      deepTraceStatusListener?.('memory-only');
    });
    expect(deepTraceSwitch(renderer).props.checked).toBe(true);
    expect(deepTraceTile(renderer).props['data-description']).toContain('Recording in memory');
    expect(deepTraceTile(renderer).props['data-description']).toContain('restart');
    renderer.unmount();
  });

  it('shows unavailable trace storage on an already-unavailable mount', () => {
    deepTracePreference = true;
    deepTraceRuntimeStatus = 'unavailable';
    mocks.subscribeDeepTraceStatus.mockImplementation((listener: (status: string) => void) => {
      deepTraceStatusListener = listener;
      return () => {
        if (deepTraceStatusListener === listener) deepTraceStatusListener = undefined;
      };
    });

    const renderer = create(<About requestClose={vi.fn()} />);

    expect(deepTraceSwitch(renderer).props.checked).toBe(true);
    expect(deepTraceTile(renderer).props['data-description']).toContain(
      'Enabled, but trace storage is currently unavailable.'
    );
    expect(deepTraceTile(renderer).props['data-description']).not.toContain('Recording');
    renderer.unmount();
  });

  it('reports an unexpected trace preference rejection without an unhandled failure', async () => {
    mocks.setDeepTraceEnabled.mockRejectedValue(new Error('unexpected rejection'));
    const renderer = create(<About requestClose={vi.fn()} />);

    await act(async () => {
      deepTraceSwitch(renderer).props.onChange({ target: { checked: true } });
      await Promise.resolve();
    });

    expect(deepTraceSwitch(renderer).props.checked).toBe(false);
    expect(deepTraceTile(renderer).props['data-description']).toContain(
      'Trace storage unavailable.'
    );
    renderer.unmount();
  });

  it('stops for this session and warns when the disabled preference cannot be saved', async () => {
    deepTracePreference = true;
    deepTraceRuntimeStatus = 'recording';
    mocks.setDeepTraceEnabled.mockImplementation(async () => {
      deepTraceRuntimeStatus = 'disabled';
      deepTraceStatusListener?.('disabled');
      return false;
    });
    const renderer = create(<About requestClose={vi.fn()} />);

    await act(async () => {
      deepTraceSwitch(renderer).props.onChange({ target: { checked: false } });
      await Promise.resolve();
    });

    expect(deepTraceSwitch(renderer).props.checked).toBe(false);
    expect(deepTraceTile(renderer).props['data-description']).toContain(
      'may re-enable after restart'
    );
    renderer.unmount();
  });

  it('disables the trace controls while an enable is pending', async () => {
    let resolveEnable: ((saved: boolean) => void) | undefined;
    const pendingEnable = new Promise<boolean>((resolve) => {
      resolveEnable = resolve;
    });
    mocks.setDeepTraceEnabled.mockImplementation(() => {
      deepTracePreference = true;
      deepTraceRuntimeStatus = 'starting';
      deepTraceStatusListener?.('starting');
      return pendingEnable;
    });
    const renderer = create(<About requestClose={vi.fn()} />);

    act(() => {
      deepTraceSwitch(renderer).props.onChange({ target: { checked: true } });
    });
    expect(deepTraceSwitch(renderer).props.disabled).toBe(true);
    expect(deepTraceTile(renderer).findByType('button').props.disabled).toBe(true);

    await act(async () => {
      deepTraceSwitch(renderer).props.onChange({ target: { checked: false } });
      await Promise.resolve();
    });
    expect(mocks.setDeepTraceEnabled).toHaveBeenCalledOnce();

    await act(async () => {
      resolveEnable?.(true);
      await pendingEnable;
    });

    expect(deepTraceSwitch(renderer).props.checked).toBe(true);
    expect(deepTraceSwitch(renderer).props.disabled).toBe(false);
    renderer.unmount();
  });

  it('ignores another toggle until the current preference change settles', async () => {
    let resolveEnable: ((saved: boolean) => void) | undefined;
    const pendingEnable = new Promise<boolean>((resolve) => {
      resolveEnable = resolve;
    });
    mocks.setDeepTraceEnabled.mockImplementation(() => {
      deepTracePreference = true;
      deepTraceRuntimeStatus = 'recording';
      deepTraceStatusListener?.('recording');
      return pendingEnable;
    });
    const renderer = create(<About requestClose={vi.fn()} />);

    act(() => {
      deepTraceSwitch(renderer).props.onChange({ target: { checked: true } });
    });
    expect(deepTraceSwitch(renderer).props.disabled).toBe(true);
    expect(deepTraceTile(renderer).findByType('button').props.disabled).toBe(true);

    await act(async () => {
      deepTraceSwitch(renderer).props.onChange({ target: { checked: false } });
      await Promise.resolve();
    });
    expect(mocks.setDeepTraceEnabled).toHaveBeenCalledOnce();

    await act(async () => {
      resolveEnable?.(true);
      await pendingEnable;
    });

    expect(deepTraceSwitch(renderer).props.checked).toBe(true);
    renderer.unmount();
  });

  it('clears retained deep trace without changing its enabled state', async () => {
    deepTracePreference = true;
    deepTraceRuntimeStatus = 'recording';
    const renderer = create(<About requestClose={vi.fn()} />);
    const clearButton = deepTraceTile(renderer).findByType('button');

    await act(async () => {
      await clearButton.props.onClick();
    });

    expect(mocks.clearDeepTrace).toHaveBeenCalledOnce();
    expect(deepTraceSwitch(renderer).props.checked).toBe(true);
    renderer.unmount();
  });

  it('keeps unavailable trace storage truthful after clearing', async () => {
    deepTracePreference = true;
    deepTraceRuntimeStatus = 'unavailable';
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<About requestClose={vi.fn()} />);
    });
    const clearButton = deepTraceTile(renderer).findByType('button');

    await act(async () => {
      await clearButton.props.onClick();
    });

    expect(mocks.clearDeepTrace).toHaveBeenCalledOnce();
    expect(deepTraceSwitch(renderer).props.checked).toBe(true);
    expect(deepTraceTile(renderer).props['data-description']).toContain(
      'Enabled, but trace storage is currently unavailable.'
    );
    expect(deepTraceTile(renderer).props['data-description']).not.toContain('Recording');
    renderer.unmount();
  });
});
