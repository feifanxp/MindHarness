import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { createMatrixClient } from '../../mindroom/matrix/matrixClientFactory';
import { login } from './login/loginUtil';
import { register } from './register/registerUtil';

vi.mock('../../mindroom/matrix/matrixClientFactory', () => ({
  createMatrixClient: vi.fn(),
}));

describe('authentication refresh-token requests', () => {
  it('requests a refresh token for every login flow', async () => {
    const loginRequest = vi.fn().mockResolvedValue({
      access_token: 'access',
      device_id: 'DEVICE',
      user_id: '@alice:example.com',
    });
    vi.mocked(createMatrixClient).mockReturnValue({ loginRequest } as never);

    await login('https://example.com', {
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: 'alice' },
      password: 'secret',
    });

    expect(loginRequest).toHaveBeenCalledWith(expect.objectContaining({ refresh_token: true }));
  });

  it('requests a refresh token throughout registration UIA', async () => {
    const registerRequest = vi.fn().mockResolvedValue({
      access_token: 'access',
      device_id: 'DEVICE',
      user_id: '@alice:example.com',
    });
    const mx = { baseUrl: 'https://example.com', registerRequest } as unknown as MatrixClient;

    await register(mx, { username: 'alice', password: 'secret' });
    await register(mx, {
      username: 'alice',
      password: 'secret',
      auth: { type: 'm.login.dummy', session: 'uia-session' },
    });

    expect(registerRequest).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ refresh_token: true })
    );
    expect(registerRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        refresh_token: true,
        auth: expect.objectContaining({ session: 'uia-session' }),
      })
    );
  });
});
