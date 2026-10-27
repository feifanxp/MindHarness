import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { sendComputerContinuation } from './continuation';

const AGENT = '@mindroom_helper:example.org';

const sentFormattedBody = async (rawDisplayName: string | undefined): Promise<string> => {
  const sendMessage = vi.fn().mockResolvedValue({ event_id: '$continuation' });
  const mx = {
    getRoom: () => ({
      getMember: (userId: string) =>
        userId === AGENT && rawDisplayName ? { rawDisplayName } : null,
    }),
    sendMessage,
  } as unknown as MatrixClient;
  await sendComputerContinuation(mx, '!room:example.org', undefined, AGENT);
  return sendMessage.mock.calls[0][1].formatted_body;
};

describe('sendComputerContinuation', () => {
  it('labels the mention like the composer: display name, else the local part', async () => {
    expect(await sentFormattedBody('Helper <Bot>')).toContain('>Helper &lt;Bot&gt;</a>');
    expect(await sentFormattedBody(AGENT)).toContain('>mindroom_helper</a>');
    expect(await sentFormattedBody(undefined)).toContain('>mindroom_helper</a>');
  });
});
