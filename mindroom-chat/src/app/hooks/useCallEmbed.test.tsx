import React, { createRef } from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { Room } from 'matrix-js-sdk';
import {
  CallEmbedRefContextProvider,
  getCallEmbedViewportPlacement,
  useCallEmbedTitleSync,
  useCallJoined,
  useCallEmbedRef,
  useCallStart,
} from './useCallEmbed';
import { CallEmbed } from '../plugins/call';

const translationMocks = vi.hoisted(() => ({ callTitle: 'Call' }));
const callEmbedMocks = vi.hoisted(() => ({
  getWidget: vi.fn(() => ({ id: 'widget' })),
  constructorArgs: [] as unknown[],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: () => translationMocks.callTitle,
    i18n: { resolvedLanguage: 'fr', language: 'fr' },
  }),
}));

vi.mock('../plugins/call', async (importOriginal) => {
  const original = await importOriginal<typeof import('../plugins/call')>();
  class MockCallEmbed {
    static getIntent = vi.fn(() => 'start_call');

    static getWidget = callEmbedMocks.getWidget;

    constructor(...args: unknown[]) {
      callEmbedMocks.constructorArgs = args;
    }
  }
  return { ...original, CallEmbed: MockCallEmbed };
});

vi.mock('./useMatrixClient', () => ({
  useMatrixClient: () => ({
    matrixRTC: { getRoomSession: () => ({ memberships: [] }) },
  }),
}));

// The real useTheme drags in vanilla-extract styles that cannot load in vitest.
vi.mock('./useTheme', () => ({
  ThemeKind: { Dark: 'dark', Light: 'light' },
  useTheme: () => ({ id: 'dark-theme', kind: 'dark', classNames: [] }),
}));

type StartCall = ReturnType<typeof useCallStart>;

function CallStarter({ onReady }: { onReady: (startCall: StartCall) => void }) {
  const startCall = useCallStart();
  onReady(startCall);
  return <span>call-starter</span>;
}

describe('useCallStart', () => {
  // Regression: the 2026-07-12 device build rendered UserRoomProfileRenderer
  // outside CallEmbedProvider, and useCallStart threw during render for every
  // opened profile ("CallEmbedRef is not provided!"), taking down the whole
  // profile surface before a call could be attempted.
  it('renders without a CallEmbedRef provider and fails only at call time', () => {
    let startCall: StartCall | undefined;
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <CallStarter
          onReady={(fn) => {
            startCall = fn;
          }}
        />
      );
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('call-starter');
    expect(startCall).toBeDefined();
    expect(() => startCall!({} as Room)).toThrow(
      'Failed to start call, No embed container element found!'
    );
  });

  it('fails at call time while the provided container is unmounted', () => {
    let startCall: StartCall | undefined;
    const emptyRef = createRef<HTMLDivElement>();
    act(() => {
      create(
        <CallEmbedRefContextProvider value={emptyRef}>
          <CallStarter
            onReady={(fn) => {
              startCall = fn;
            }}
          />
        </CallEmbedRefContextProvider>
      );
    });

    expect(() => startCall!({} as Room)).toThrow(
      'Failed to start call, No embed container element found!'
    );
  });

  it('passes the selected normalized language and translated title when starting a call', () => {
    let startCall: StartCall | undefined;
    const container = {} as HTMLDivElement;
    const ref = { current: container };
    act(() => {
      create(
        <CallEmbedRefContextProvider value={ref}>
          <CallStarter
            onReady={(fn) => {
              startCall = fn;
            }}
          />
        </CallEmbedRefContextProvider>
      );
    });

    startCall!({} as Room);

    expect(callEmbedMocks.getWidget).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'start_call',
      'dark',
      'fr'
    );
    expect(callEmbedMocks.constructorArgs[4]).toBe('Call');
  });
});

describe('useCallEmbedRef', () => {
  it('still requires a provider for consumers that own the container', () => {
    function RefConsumer() {
      useCallEmbedRef();
      return null;
    }

    expect(() => {
      act(() => {
        create(<RefConsumer />);
      });
    }).toThrow('CallEmbedRef is not provided!');
  });
});

describe('useCallJoined', () => {
  const makeEmbed = (joined: boolean): CallEmbed =>
    ({
      joined,
      call: { on: vi.fn(), off: vi.fn() },
    } as unknown as CallEmbed);

  function JoinedStatus({ embed }: { embed: CallEmbed }) {
    return <span>{useCallJoined(embed) ? 'joined' : 'joining'}</span>;
  }

  it('resets when a joined embed is replaced by an unjoined embed', () => {
    const first = makeEmbed(true);
    const replacement = makeEmbed(false);
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(<JoinedStatus embed={first} />);
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('joined');

    act(() => {
      renderer.update(<JoinedStatus embed={replacement} />);
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('joining');
  });
});

describe('useCallEmbedTitleSync', () => {
  function TitleSync({ embed }: { embed: CallEmbed }) {
    useCallEmbedTitleSync(embed);
    return null;
  }

  it('updates the accessible title without navigating the active iframe', () => {
    const embed = {
      iframe: { src: 'https://example.org/active-call', title: 'Call' },
      setTitle(title: string) {
        this.iframe.title = title;
      },
    } as CallEmbed;
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(<TitleSync embed={embed} />);
    });

    const activeCallUrl = embed.iframe.src;
    translationMocks.callTitle = '通話';
    act(() => renderer.update(<TitleSync embed={embed} />));

    expect(embed.iframe.title).toBe('通話');
    expect(embed.iframe.src).toBe(activeCallUrl);
  });
});

describe('getCallEmbedViewportPlacement', () => {
  it('positions the fixed call host from viewport coordinates', () => {
    const container = {
      // These offset-parent coordinates caused the call host to cover the app
      // shell when the room pane itself was offset by navigation columns.
      offsetTop: 0,
      offsetLeft: 0,
      clientWidth: 720,
      clientHeight: 480,
      getBoundingClientRect: () => ({
        top: 72,
        left: 396,
        width: 1180,
        height: 764,
      }),
    } as unknown as HTMLDivElement;

    expect(getCallEmbedViewportPlacement(container)).toEqual({
      top: '72px',
      left: '396px',
      width: '1180px',
      height: '764px',
    });
  });
});
