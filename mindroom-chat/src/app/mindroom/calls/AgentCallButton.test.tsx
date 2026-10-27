import React from 'react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../locales/en.json';
import { AgentCallButton } from './AgentCallButton';

const mocks = vi.hoisted(() => ({
  findAgentCallRoom: vi.fn(),
  prepareAgentCallRoom: vi.fn(),
  requestMicrophoneAccess: vi.fn(),
  startCall: vi.fn(),
  closeProfile: vi.fn(),
  selectedRoomId: undefined as string | undefined,
  searchParams: new URLSearchParams(),
}));

const VOICE_CALLS_STATUS = '🤖 Model: openai/gpt-5.5 | 📞 Voice calls';
const ROOM_ID = '!room:mindroom.test';

vi.mock('./agentCall', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./agentCall')>()),
  clearAgentCallOrigin: vi.fn(),
  findAgentCallRoom: mocks.findAgentCallRoom,
  prepareAgentCallRoom: mocks.prepareAgentCallRoom,
}));

vi.mock('../voice/microphoneAccess', () => ({
  requestMicrophoneAccess: mocks.requestMicrophoneAccess,
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getUserId: () => '@alice:mindroom.test',
    getSafeUserId: () => '@alice:mindroom.test',
  }),
}));

vi.mock('../../hooks/useClientConfig', () => ({
  useClientConfig: () => ({ createRoom: { defaultEncryption: true } }),
}));

vi.mock('../../hooks/useCallEmbed', () => ({
  useCallEmbed: () => undefined,
  useCallStart: () => mocks.startCall,
}));

vi.mock('../../hooks/useLivekitSupport', () => ({
  useLivekitSupport: () => true,
}));

vi.mock('../../utils/rtc', () => ({
  webRTCSupported: () => true,
}));

vi.mock('../../state/hooks/userRoomProfile', () => ({
  useCloseUserRoomProfile: () => mocks.closeProfile,
}));

vi.mock('../../hooks/router/useSelectedRoom', () => ({
  useSelectedRoom: () => mocks.selectedRoomId,
}));

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [mocks.searchParams],
}));

describe('AgentCallButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectedRoomId = ROOM_ID;
    mocks.searchParams = new URLSearchParams({ threadId: '$root' });
    mocks.requestMicrophoneAccess.mockResolvedValue(undefined);
    mocks.findAgentCallRoom.mockReturnValue({ roomId: '!call:mindroom.test' });
    mocks.prepareAgentCallRoom.mockResolvedValue(undefined);
  });

  it('is only offered for a same-homeserver MindRoom agent', () => {
    const human = create(<AgentCallButton roomId={ROOM_ID} userId="@bob:mindroom.test" />);
    const foreignAgent = create(
      <AgentCallButton
        roomId={ROOM_ID}
        userId="@mindroom_helper:elsewhere.test"
        displayName="Helper"
      />
    );
    const localAgentWithoutCalls = create(
      <AgentCallButton
        roomId={ROOM_ID}
        userId="@mindroom_helper:mindroom.test"
        displayName="Helper"
        presenceStatus="🤖 Model: openai/gpt-5.5"
      />
    );
    const localVoiceAgent = create(
      <AgentCallButton
        roomId={ROOM_ID}
        userId="@mindroom_helper:mindroom.test"
        displayName="Helper"
        presenceStatus={VOICE_CALLS_STATUS}
      />
    );

    expect(human.toJSON()).toBeNull();
    expect(foreignAgent.toJSON()).toBeNull();
    expect(localAgentWithoutCalls.toJSON()).toBeNull();
    expect(JSON.stringify(localVoiceAgent.toJSON())).toContain('Call');
  });

  it('starts the call in the agent call room without leaving the conversation', async () => {
    const renderer = create(
      <AgentCallButton
        roomId={ROOM_ID}
        userId="@mindroom_helper:mindroom.test"
        displayName="Helper"
        presenceStatus={VOICE_CALLS_STATUS}
      />
    );
    const button = renderer.root.findByType('button');

    await act(async () => {
      await button.props.onClick();
    });

    expect(mocks.requestMicrophoneAccess).toHaveBeenCalledOnce();
    expect(mocks.requestMicrophoneAccess.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.prepareAgentCallRoom.mock.invocationCallOrder[0]
    );
    expect(mocks.prepareAgentCallRoom).toHaveBeenCalledWith(
      expect.anything(),
      { roomId: '!call:mindroom.test' },
      '@mindroom_helper:mindroom.test',
      { room_id: ROOM_ID, thread_id: '$root' }
    );
    expect(mocks.startCall).toHaveBeenCalledWith(
      { roomId: '!call:mindroom.test' },
      { microphone: true, video: false, sound: true }
    );
    expect(mocks.closeProfile).toHaveBeenCalledOnce();
    expect(renderer.root.findByType('button').props.disabled).toBe(false);
  });

  it.each([
    ['another room is selected', '!elsewhere:mindroom.test', 'threadId=$root'],
    ['the route has no thread', ROOM_ID, ''],
    ['the thread root is still a local echo', ROOM_ID, 'threadId=~local-echo'],
  ])('stamps only the room when %s', async (_case, selectedRoomId, search) => {
    mocks.selectedRoomId = selectedRoomId;
    mocks.searchParams = new URLSearchParams(search);
    const renderer = create(
      <AgentCallButton
        roomId={ROOM_ID}
        userId="@mindroom_helper:mindroom.test"
        displayName="Helper"
        presenceStatus={VOICE_CALLS_STATUS}
      />
    );

    await act(async () => {
      await renderer.root.findByType('button').props.onClick();
    });

    expect(mocks.prepareAgentCallRoom).toHaveBeenCalledWith(
      expect.anything(),
      { roomId: '!call:mindroom.test' },
      '@mindroom_helper:mindroom.test',
      { room_id: ROOM_ID, thread_id: null }
    );
  });

  it('does not prepare a call room when microphone access is denied', async () => {
    mocks.requestMicrophoneAccess.mockRejectedValueOnce(
      new Error(
        'Microphone access is blocked. Allow microphone access for MindRoom Chat in iPhone settings and try again.'
      )
    );
    const renderer = create(
      <AgentCallButton
        roomId={ROOM_ID}
        userId="@mindroom_helper:mindroom.test"
        displayName="Helper"
        presenceStatus={VOICE_CALLS_STATUS}
      />
    );

    await act(async () => {
      await renderer.root.findByType('button').props.onClick();
    });

    expect(mocks.prepareAgentCallRoom).not.toHaveBeenCalled();
    expect(mocks.startCall).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer.toJSON())).toContain(
      'Allow microphone access for MindRoom Chat'
    );
  });

  it('keeps the profile open when the call fails to start', async () => {
    mocks.startCall.mockImplementationOnce(() => {
      throw new Error('embed unavailable');
    });
    const renderer = create(
      <AgentCallButton
        roomId={ROOM_ID}
        userId="@mindroom_helper:mindroom.test"
        displayName="Helper"
        presenceStatus={VOICE_CALLS_STATUS}
      />
    );

    await act(async () => {
      await renderer.root.findByType('button').props.onClick();
    });

    expect(mocks.closeProfile).not.toHaveBeenCalled();
  });

  it('shows a failure when the call room cannot be prepared', async () => {
    mocks.prepareAgentCallRoom.mockRejectedValueOnce(new Error('M_FORBIDDEN'));
    const renderer = create(
      <AgentCallButton
        roomId={ROOM_ID}
        userId="@mindroom_helper:mindroom.test"
        displayName="Helper"
        presenceStatus={VOICE_CALLS_STATUS}
      />
    );

    await act(async () => {
      await renderer.root.findByType('button').props.onClick();
    });

    expect(mocks.startCall).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer.toJSON())).toContain('Failed to start the call.');
  });
});

it('updates a retained microphone failure when the language changes', async () => {
  const language = createInstance();
  await language.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: { translation: en },
      de: {
        translation: {
          mindroomUi: {
            voice: {
              errors: {
                microphoneBlockedIos: 'Mikrofonzugriff in den iPhone-Einstellungen erlauben.',
              },
            },
          },
        },
      },
    },
  });
  mocks.requestMicrophoneAccess.mockRejectedValueOnce(
    new Error(
      'Microphone access is blocked. Allow microphone access for MindRoom Chat in iPhone settings and try again.'
    )
  );
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <I18nextProvider i18n={language}>
        <AgentCallButton
          roomId={ROOM_ID}
          userId="@mindroom_helper:mindroom.test"
          presenceStatus={VOICE_CALLS_STATUS}
        />
      </I18nextProvider>
    );
  });
  await act(async () => {
    await renderer.root.findByType('button').props.onClick();
  });
  expect(JSON.stringify(renderer!.toJSON())).toContain('Allow microphone access');
  await act(async () => {
    await language.changeLanguage('de');
  });
  expect(JSON.stringify(renderer!.toJSON())).toContain(
    'Mikrofonzugriff in den iPhone-Einstellungen erlauben.'
  );
  act(() => renderer!.unmount());
});
