import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createInstance, i18n as I18n } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { ClientConfig, ClientConfigProvider } from '../../hooks/useClientConfig';
import { CreateChat } from './CreateChat';

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('../../pages/pathUtils', () => ({
  getDirectRoomPath: (roomId: string) => `/direct/${roomId}`,
}));

vi.mock('../../components/sequence-card', () => ({
  SequenceCard: ({ children, as, ...props }: any) =>
    React.createElement(as ?? 'div', props, children),
}));

vi.mock('../../components/setting-tile', () => ({
  SettingTile: ({ title, description, children, after }: any) =>
    React.createElement('div', null, title, description, children, after),
}));

// The autocomplete drags in vanilla-extract styles and the user directory
// stack; CreateChat tests only exercise the form submit + room policy logic.
vi.mock('../../components/invite-user-prompt', () => ({
  InviteUserAutocomplete: React.forwardRef(
    ({ inputValue, onInputChange }: any, ref: React.ForwardedRef<HTMLInputElement>) =>
      React.createElement('input', {
        ref,
        name: 'userIdInput',
        value: inputValue,
        onChange: (evt: any) => onInputChange(evt.target.value),
      })
  ),
}));

vi.mock('../../components/create-room', () => ({
  createRoomEncryptionState: () => ({
    type: 'm.room.encryption',
    state_key: '',
    content: {
      algorithm: 'm.megolm.v1.aes-sha2',
    },
  }),
}));

const createRoomMock = vi.fn();
const matrixClient = {
  createRoom: createRoomMock,
  getAccountData: vi.fn(),
  setAccountData: vi.fn(),
} as any;

const renderChat = (clientConfig: ClientConfig): ReactTestRenderer =>
  create(
    React.createElement(
      ClientConfigProvider,
      { value: clientConfig },
      React.createElement(
        MatrixClientProvider,
        { value: matrixClient },
        React.createElement(CreateChat)
      )
    )
  );

const textContent = (renderer: ReactTestRenderer): string => JSON.stringify(renderer.toJSON());

const createTestI18n = async (): Promise<I18n> => {
  const language = createInstance();
  await language.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: {
        translation: {
          featureUi: { createChat: { userId: 'User ID', create: 'Create' } },
        },
      },
      de: {
        translation: {
          featureUi: { createChat: { userId: 'Benutzer-ID', create: 'Erstellen' } },
        },
      },
    },
    interpolation: { escapeValue: false },
  });
  return language;
};

const submitForm = async (
  renderer: ReactTestRenderer,
  userId = '@agent:mindroom.test'
): Promise<void> => {
  const input = renderer.root.findByType('input');
  await act(async () => {
    input.props.onChange({ target: { value: userId } });
  });

  const form = renderer.root.findByType('form');
  await act(async () => {
    form.props.onSubmit({ preventDefault: vi.fn() });
  });
};

describe('CreateChat room policy config', () => {
  beforeEach(() => {
    createRoomMock.mockReset();
    createRoomMock.mockResolvedValue({ room_id: '!dm:mindroom.test' });
    matrixClient.getAccountData.mockReset();
    matrixClient.setAccountData.mockReset();
    navigateMock.mockReset();
  });

  it('hides encryption control while creating an unencrypted DM from configured default', async () => {
    const renderer = renderChat({
      createRoom: {
        showEncryptionOption: false,
        defaultEncryption: false,
      },
    } as ClientConfig);

    expect(textContent(renderer)).not.toContain('End-to-End Encryption');

    await submitForm(renderer);

    expect(createRoomMock).toHaveBeenCalledWith(
      expect.objectContaining({
        is_direct: true,
        initial_state: [],
      })
    );
  });

  it('uses configured hidden default when encrypted DMs are enabled by policy', async () => {
    const renderer = renderChat({
      createRoom: {
        showEncryptionOption: false,
        defaultEncryption: true,
      },
    } as ClientConfig);

    expect(textContent(renderer)).not.toContain('End-to-End Encryption');

    await submitForm(renderer);

    expect(createRoomMock).toHaveBeenCalledWith(
      expect.objectContaining({
        is_direct: true,
        initial_state: [
          {
            type: 'm.room.encryption',
            state_key: '',
            content: {
              algorithm: 'm.megolm.v1.aes-sha2',
            },
          },
        ],
      })
    );
  });

  it('updates visible labels when the active language changes', async () => {
    const language = await createTestI18n();
    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(
        React.createElement(
          I18nextProvider,
          { i18n: language },
          React.createElement(
            ClientConfigProvider,
            { value: {} as ClientConfig },
            React.createElement(
              MatrixClientProvider,
              { value: matrixClient },
              React.createElement(CreateChat)
            )
          )
        )
      );
    });

    expect(textContent(renderer!)).toContain('User ID');
    expect(textContent(renderer!)).toContain('Create');

    await act(async () => {
      await language.changeLanguage('de');
    });

    expect(textContent(renderer!)).toContain('Benutzer-ID');
    expect(textContent(renderer!)).toContain('Erstellen');
    expect(textContent(renderer!)).not.toContain('User ID');
    act(() => renderer!.unmount());
  });
});
