import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Capabilities } from 'matrix-js-sdk';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CapabilitiesProvider } from '../../hooks/useCapabilities';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { ClientConfig, ClientConfigProvider } from '../../hooks/useClientConfig';
import { CreateRoomAccess, CreateRoomType } from '../../components/create-room/types';
import { CreateRoomForm } from './CreateRoom';

const createRoomMock = vi.hoisted(() => vi.fn());

vi.mock('../../components/sequence-card', () => ({
  SequenceCard: ({ children, as, ...props }: any) =>
    React.createElement(as ?? 'div', props, children),
}));

vi.mock('../../components/setting-tile', () => ({
  SettingTile: ({ title, description, children, after }: any) =>
    React.createElement('div', null, title, description, children, after),
}));

vi.mock('../../components/create-room', () => {
  return {
    AdditionalCreatorInput: () => React.createElement('div', null),
    CreateRoomAccess,
    CreateRoomAccessSelector: ({ onSelect }: { onSelect: (value: CreateRoomAccess) => void }) =>
      React.createElement(
        'div',
        null,
        React.createElement('button', {
          type: 'button',
          'aria-label': 'Private',
          onClick: () => onSelect(CreateRoomAccess.Private),
        }),
        React.createElement('button', {
          type: 'button',
          'aria-label': 'Public',
          onClick: () => onSelect(CreateRoomAccess.Public),
        })
      ),
    CreateRoomAliasInput: () => React.createElement('input', { name: 'aliasInput' }),
    CreateRoomType,
    RoomVersionSelector: () => React.createElement('div', null),
    createRoom: createRoomMock,
    useAdditionalCreators: () => ({
      additionalCreators: [],
      addAdditionalCreator: vi.fn(),
      removeAdditionalCreator: vi.fn(),
    }),
  };
});

const capabilities: Capabilities = {
  'm.room_versions': {
    default: '9',
    available: {
      '9': 'stable',
    },
  },
};

const matrixClient = {} as any;

const renderForm = (clientConfig: ClientConfig): ReactTestRenderer =>
  create(
    React.createElement(
      ClientConfigProvider,
      { value: clientConfig },
      React.createElement(
        CapabilitiesProvider,
        { value: capabilities },
        React.createElement(
          MatrixClientProvider,
          { value: matrixClient },
          React.createElement(CreateRoomForm)
        )
      )
    )
  );

const textContent = (renderer: ReactTestRenderer): string => JSON.stringify(renderer.toJSON());

const submitForm = async (renderer: ReactTestRenderer, roomName = 'Agent room'): Promise<void> => {
  const form = renderer.root.findByType('form');

  await act(async () => {
    form.props.onSubmit({
      preventDefault: vi.fn(),
      currentTarget: {
        nameInput: { value: roomName },
        topicTextAria: { value: '' },
      },
    });
  });
};

describe('CreateRoomForm room policy config', () => {
  beforeEach(() => {
    createRoomMock.mockReset();
    createRoomMock.mockResolvedValue('!created:mindroom.test');
  });

  it('hides encryption and federation controls while using configured defaults', async () => {
    const renderer = renderForm({
      createRoom: {
        showEncryptionOption: false,
        defaultEncryption: true,
        showFederationOption: false,
        defaultFederation: false,
      },
    } as ClientConfig);

    expect(textContent(renderer)).not.toContain('End-to-End Encryption');
    expect(textContent(renderer)).not.toContain('Allow Federation');

    await submitForm(renderer);

    expect(createRoomMock).toHaveBeenCalledWith(
      matrixClient,
      expect.objectContaining({
        encryption: true,
        allowFederation: false,
      })
    );
  });

  it('keeps public room creation unencrypted even when the configured default enables encryption', async () => {
    const renderer = create(
      React.createElement(
        ClientConfigProvider,
        {
          value: {
            createRoom: {
              showEncryptionOption: false,
              defaultEncryption: true,
              showFederationOption: false,
              defaultFederation: false,
            },
          } as ClientConfig,
        },
        React.createElement(
          CapabilitiesProvider,
          { value: capabilities },
          React.createElement(
            MatrixClientProvider,
            { value: matrixClient },
            React.createElement(CreateRoomForm, { defaultAccess: CreateRoomAccess.Public })
          )
        )
      )
    );

    await submitForm(renderer);

    expect(createRoomMock).toHaveBeenCalledWith(
      matrixClient,
      expect.objectContaining({
        access: CreateRoomAccess.Public,
        encryption: false,
        allowFederation: false,
      })
    );
  });
});
