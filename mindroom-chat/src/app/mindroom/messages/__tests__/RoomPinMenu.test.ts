import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../components/page', () => ({
  PageScroll: ({ header, children }: React.PropsWithChildren<{ header?: React.ReactNode }>) =>
    React.createElement('div', null, header, children),
}));

const APPROVAL_EVENT_TYPE = 'io.mindroom.tool_approval';

vi.mock('../../../hooks/useVirtualListScrollMargin', () => ({
  useVirtualListScrollMargin: () => 0,
}));

const {
  getEditedEventMock,
  navigateRoomMock,
  pinnedEventMock,
  renderMessageContentMock,
  roomMock,
  settingValues,
} = vi.hoisted(() => ({
  getEditedEventMock: vi.fn(() => undefined),
  navigateRoomMock: vi.fn(),
  pinnedEventMock: {
    replyEventId: undefined,
    threadRootId: undefined,
    getContent: vi.fn(() => ({
      approval_id: 'approval-1',
      tool_name: 'web_search',
      arguments: { query: 'release date' },
      agent_name: 'research',
      status: 'pending',
      requested_at: '2026-04-10T12:00:00Z',
      expires_at: '2026-04-17T12:00:00Z',
      resolved_at: null,
      resolved_by: null,
      resolution_reason: null,
    })),
    getOriginalContent() {
      return this.getContent();
    },
    getId: vi.fn(() => '$approval'),
    getSender: vi.fn(() => '@alice:example.org'),
    getTs: vi.fn(() => 0),
    getType: vi.fn(() => APPROVAL_EVENT_TYPE),
    getUnsigned: vi.fn(() => ({})),
    isRedacted: vi.fn(() => false),
    replacingEvent: vi.fn(() => undefined),
  },
  renderMessageContentMock: vi.fn(),
  roomMock: {
    roomId: '!room:example.org',
    hasEncryptionStateEvent: vi.fn(() => false),
    getTimelineForEvent: vi.fn(() => undefined),
  },
  settingValues: {} as Record<string, boolean>,
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 1,
    getVirtualItems: () => [{ index: 0, key: 0, start: 0, size: 1 }],
    measureElement: vi.fn(),
  }),
}));

vi.mock('folds', () => {
  const Box = ({
    as: Tag = 'div',
    children,
    ...props
  }: {
    as?: keyof JSX.IntrinsicElements;
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => React.createElement(Tag, props, children);

  const ButtonLike = ({
    children,
    onClick,
    ...props
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    [key: string]: unknown;
  }) => React.createElement('button', { ...props, onClick, type: 'button' }, children);

  const ForwardedDiv = React.forwardRef<
    HTMLDivElement,
    { children?: React.ReactNode; [key: string]: unknown }
  >(({ children, ...props }, ref) => React.createElement('div', { ...props, ref }, children));

  return {
    Avatar: Box,
    Box,
    Chip: ButtonLike,
    color: {
      Critical: {
        Main: 'red',
      },
    },
    config: {
      radii: {
        R300: '12px',
      },
      space: {
        S200: '8px',
        S400: '16px',
        S700: '28px',
      },
    },
    Header: Box,
    Icon: ({ src }: { src?: string }) => React.createElement('span', null, src ?? 'icon'),
    IconButton: ButtonLike,
    Icons: {
      Cross: 'Cross',
      User: 'User',
    },
    Menu: ForwardedDiv,
    Scroll: ForwardedDiv,
    Spinner: () => React.createElement('span', null, 'spinner'),
    Text: ({ as: Tag = 'span', children, ...props }: any) =>
      React.createElement(Tag, props, children),
    toRem: (value: number) => `${value}px`,
  };
});

vi.mock('../../../components/sequence-card', () => ({
  SequenceCard: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('div', props, children),
}));

vi.mock('../MindroomRoomPinMenu.css', () => ({
  PinMenu: 'PinMenu',
  PinMenuHeader: 'PinMenuHeader',
  PinMenuContent: 'PinMenuContent',
}));

vi.mock('../../../components/message', () => ({
  AvatarBase: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  DefaultPlaceholder: () => React.createElement('div', { 'data-renderer': 'placeholder' }),
  ImageContent: () => null,
  MessageNotDecryptedContent: () => React.createElement('span', null, 'not-decrypted'),
  MessageUnsupportedContent: () => React.createElement('span', null, 'unsupported'),
  ModernLayout: ({ before, children }: { before?: React.ReactNode; children?: React.ReactNode }) =>
    React.createElement('div', null, before, children),
  MSticker: () => React.createElement('div', { 'data-renderer': 'sticker' }),
  RedactedContent: () => React.createElement('div', { 'data-renderer': 'redacted' }),
  Reply: () => null,
  Time: () => React.createElement('span', null, 'time'),
  Username: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('span', props, children),
  UsernameBold: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('strong', null, children),
}));

vi.mock('../../../components/user-avatar', () => ({
  UserAvatar: () => React.createElement('div', { 'data-renderer': 'user-avatar' }),
}));

vi.mock('../../../utils/matrix', () => ({
  getMxIdLocalPart: () => 'alice',
  mxcUrlToHttp: () => undefined,
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getUserId: () => '@me:example.org',
    sendStateEvent: vi.fn(),
  }),
}));

vi.mock('../../../utils/room', () => ({
  getEditedEvent: getEditedEventMock,
  getMemberAvatarMxc: vi.fn(() => undefined),
  getMemberDisplayName: vi.fn(() => 'Alice'),
  getStateEvent: vi.fn(() => undefined),
}));

vi.mock('../../../hooks/useMentionClickHandler', () => ({
  useMentionClickHandler: () => vi.fn(),
}));

vi.mock('../../../hooks/useSpoilerClickHandler', () => ({
  useSpoilerClickHandler: () => vi.fn(),
}));

vi.mock('../../../plugins/react-custom-html-parser', () => ({
  factoryRenderLinkifyWithMention: () => vi.fn(),
  getReactCustomHtmlParser: () => ({}),
  LINKIFY_OPTS: {},
  makeMentionCustomProps: () => ({}),
  renderMatrixMention: () => null,
}));

vi.mock('../../../components/RenderMessageContent', () => ({
  RenderMessageContent: ({
    edited,
    eventType,
    getContent,
    mEvent,
    urlPreview,
  }: {
    edited?: boolean;
    eventType?: string;
    getContent?: () => Record<string, unknown>;
    mEvent?: unknown;
    urlPreview?: boolean;
  }) => {
    renderMessageContentMock({ edited, eventType, getContent, mEvent, urlPreview });
    const content = getContent?.();
    const newContent = content?.['m.new_content'];
    const approvalStatus =
      typeof newContent === 'object' && newContent && !Array.isArray(newContent)
        ? (newContent as Record<string, unknown>).status
        : content?.status;

    return React.createElement('div', {
      'data-renderer': 'message-content',
      'data-event-type': eventType ?? '',
      'data-edited': edited ? 'true' : 'false',
      'data-approval-status': typeof approvalStatus === 'string' ? approvalStatus : '',
    });
  },
}));

vi.mock('../../../state/hooks/settings', () => ({
  useSetting: (_atom: unknown, key: string) => [settingValues[key] ?? false],
}));

vi.mock('../../../state/settings', () => ({
  settingsAtom: {},
}));

vi.mock('../../../styles/CustomHtml.css', () => ({
  Code: 'Code',
}));

vi.mock('../../../features/room/message', () => ({
  EncryptedContent: ({ children }: { children: () => React.ReactNode }) =>
    React.createElement(React.Fragment, null, children()),
}));

vi.mock('../../../features/room/message/EncryptedContent', () => ({
  EncryptedContent: ({ children }: { children: () => React.ReactNode }) =>
    React.createElement(React.Fragment, null, children()),
}));

vi.mock('../../../components/media', () => ({
  Image: () => null,
}));

vi.mock('../../../components/image-viewer', () => ({
  ImageViewer: () => null,
}));

vi.mock('../../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoom: navigateRoomMock,
  }),
}));

vi.mock('../../../components/virtualizer', () => ({
  VirtualTile: React.forwardRef<
    HTMLDivElement,
    { children?: React.ReactNode; [key: string]: unknown }
  >(({ children, ...props }, ref) => React.createElement('div', { ...props, ref }, children)),
}));

vi.mock('../../../hooks/usePowerLevels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../hooks/usePowerLevels')>()),
  usePowerLevelsContext: () => ({}),
}));

vi.mock('../../../hooks/useAsyncCallback', async () => {
  const actual = await vi.importActual<typeof import('../../../hooks/useAsyncCallback')>(
    '../../../hooks/useAsyncCallback'
  );

  return {
    ...actual,
    useAsyncCallback: () => [{ status: actual.AsyncStatus.Idle }, vi.fn()],
  };
});

vi.mock('../../../styles/ContainerColor.css', () => ({
  ContainerColor: () => 'ContainerColor',
}));

vi.mock('../../../hooks/usePowerLevelTags', () => ({
  usePowerLevelTags: () => [],
}));

vi.mock('../../../hooks/useTheme', () => ({
  useTheme: () => ({
    kind: 'light',
  }),
}));

vi.mock('../../../components/power', () => ({
  PowerIcon: () => null,
}));

vi.mock('../../../../util/colorMXID', () => ({
  default: () => '#123456',
}));

vi.mock('../../../hooks/useRoom', () => ({
  useIsDirectRoom: () => false,
}));

vi.mock('../../../hooks/useRoomCreators', () => ({
  useRoomCreators: () => new Set(),
}));

vi.mock('../../../hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({
    stateEvent: () => false,
  }),
}));

vi.mock('../../../hooks/useMemberPowerTag', () => ({
  getPowerTagIconSrc: () => undefined,
  useAccessiblePowerTagColors: () => new Map(),
  useGetMemberPowerTag: () => () => undefined,
}));

vi.mock('../../../hooks/useRoomCreatorsTag', () => ({
  useRoomCreatorsTag: () => undefined,
}));

vi.mock('../../../hooks/useRoomPinnedEvents', () => ({
  useRoomPinnedEvents: () => new Set(['$approval']),
}));

vi.mock('../../threads/useRoomEvent', () => ({
  useRoomEvent: () => pinnedEventMock,
}));

vi.mock('../../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

import { RoomPinMenu } from '../MindroomRoomPinMenu';

describe('RoomPinMenu', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    if (renderer) {
      act(() => {
        renderer?.unmount();
      });
    }

    renderer = undefined;
    getEditedEventMock.mockReset();
    getEditedEventMock.mockReturnValue(undefined);
    navigateRoomMock.mockReset();
    pinnedEventMock.getContent.mockClear();
    pinnedEventMock.getId.mockClear();
    pinnedEventMock.getSender.mockClear();
    pinnedEventMock.getTs.mockClear();
    pinnedEventMock.getType.mockClear();
    pinnedEventMock.getUnsigned.mockClear();
    pinnedEventMock.isRedacted.mockClear();
    pinnedEventMock.replacingEvent.mockReset();
    pinnedEventMock.replacingEvent.mockReturnValue(undefined);
    renderMessageContentMock.mockReset();
    roomMock.getTimelineForEvent.mockReset();
    roomMock.getTimelineForEvent.mockReturnValue(undefined);
    roomMock.hasEncryptionStateEvent.mockReturnValue(false);
    Object.keys(settingValues).forEach((key) => delete settingValues[key]);
  });

  it('routes pinned approval events through RenderMessageContent with the approval event type', () => {
    act(() => {
      renderer = create(
        React.createElement(RoomPinMenu, {
          room: roomMock as never,
          requestClose: vi.fn(),
        })
      );
    });

    const renderedApproval = renderer!.root.findByProps({
      'data-renderer': 'message-content',
    });

    expect(renderedApproval.props['data-event-type']).toBe(APPROVAL_EVENT_TYPE);
  });

  it('uses relation-only edits for encrypted pinned approval events', () => {
    const relationEditEvent = {
      getContent: vi.fn(() => ({
        'm.new_content': {
          status: 'denied',
          resolved_at: '2026-04-10T12:05:00Z',
          resolved_by: '@ops:example.org',
          resolution_reason: 'Missing justification',
        },
      })),
    };
    const decryptedApprovalEvent = {
      getContent: vi.fn(() => ({
        approval_id: 'approval-1',
        tool_name: 'web_search',
        arguments: { query: 'release date' },
        agent_name: 'research',
        status: 'pending',
        requested_at: '2026-04-10T12:00:00Z',
        expires_at: '2026-04-17T12:00:00Z',
        resolved_at: null,
        resolved_by: null,
        resolution_reason: null,
      })),
      getOriginalContent() {
        return this.getContent();
      },
      getId: vi.fn(() => '$approval'),
      getTs: vi.fn(() => 0),
      getType: vi.fn(() => APPROVAL_EVENT_TYPE),
      isRedacted: vi.fn(() => false),
      replacingEvent: vi.fn(() => undefined),
    };
    const timelineSet = { relations: {} };
    const eventTimeline = {
      getEvents: vi.fn(() => [decryptedApprovalEvent]),
      getTimelineSet: vi.fn(() => timelineSet),
    };

    pinnedEventMock.getType.mockReturnValue('m.room.encrypted');
    roomMock.getTimelineForEvent.mockReturnValue(eventTimeline as never);
    getEditedEventMock.mockReturnValue(relationEditEvent as never);

    act(() => {
      renderer = create(
        React.createElement(RoomPinMenu, {
          room: roomMock as never,
          requestClose: vi.fn(),
        })
      );
    });

    const renderedApproval = renderer!.root.findByProps({
      'data-renderer': 'message-content',
    });

    expect(getEditedEventMock).toHaveBeenCalledWith(
      '$approval',
      decryptedApprovalEvent,
      timelineSet
    );
    expect(renderedApproval.props['data-event-type']).toBe(APPROVAL_EVENT_TYPE);
    expect(renderedApproval.props['data-approval-status']).toBe('denied');
    expect(renderedApproval.props['data-edited']).toBe('true');
  });

  it('passes the source event through ordinary pinned message rendering', () => {
    pinnedEventMock.getType.mockReturnValue('m.room.message');
    pinnedEventMock.getContent.mockReturnValue({
      msgtype: 'm.text',
      body: 'Pinned request',
    } as never);

    act(() => {
      renderer = create(
        React.createElement(RoomPinMenu, {
          room: roomMock as never,
          requestClose: vi.fn(),
        })
      );
    });

    expect(renderMessageContentMock).toHaveBeenCalledWith(
      expect.objectContaining({ mEvent: pinnedEventMock })
    );
  });

  it.each([
    { encrypted: true, urlPreview: false },
    { encrypted: false, urlPreview: true },
  ])(
    'uses the encrypted-room URL preview setting when encrypted is $encrypted',
    ({ encrypted, urlPreview }) => {
      settingValues.urlPreview = true;
      settingValues.encUrlPreview = false;
      roomMock.hasEncryptionStateEvent.mockReturnValue(encrypted);
      pinnedEventMock.getType.mockReturnValue('m.room.message');
      pinnedEventMock.getContent.mockReturnValue({
        msgtype: 'm.text',
        body: 'https://example.org',
      } as never);

      act(() => {
        renderer = create(
          React.createElement(RoomPinMenu, {
            room: roomMock as never,
            requestClose: vi.fn(),
          })
        );
      });

      expect(renderMessageContentMock).toHaveBeenCalledWith(
        expect.objectContaining({ urlPreview })
      );
    }
  );

  it('passes the decrypted event through encrypted pinned message rendering', () => {
    const decryptedMessageEvent = {
      getContent: vi.fn(() => ({ msgtype: 'm.text', body: 'Pinned encrypted request' })),
      getId: vi.fn(() => '$approval'),
      getTs: vi.fn(() => 0),
      getType: vi.fn(() => 'm.room.message'),
      isRedacted: vi.fn(() => false),
      replacingEvent: vi.fn(() => undefined),
    };
    const eventTimeline = {
      getEvents: vi.fn(() => [decryptedMessageEvent]),
      getTimelineSet: vi.fn(() => ({ relations: {} })),
    };
    pinnedEventMock.getType.mockReturnValue('m.room.encrypted');
    roomMock.getTimelineForEvent.mockReturnValue(eventTimeline as never);

    act(() => {
      renderer = create(
        React.createElement(RoomPinMenu, {
          room: roomMock as never,
          requestClose: vi.fn(),
        })
      );
    });

    expect(renderMessageContentMock).toHaveBeenCalledWith(
      expect.objectContaining({ mEvent: decryptedMessageEvent })
    );
  });
});
