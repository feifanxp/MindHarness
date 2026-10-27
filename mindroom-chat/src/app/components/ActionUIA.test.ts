import { AuthType, UIAFlow } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { pickUIAFlow } from './ActionUIA';

const flow = (stages: string[]): UIAFlow => ({ stages });

describe('pickUIAFlow', () => {
  it('prefers SSO flow when SSO and password are both available', () => {
    const passwordFlow = flow([AuthType.Password]);
    const ssoFlow = flow([AuthType.Sso]);

    expect(pickUIAFlow([passwordFlow, ssoFlow])).toBe(ssoFlow);
  });

  it('falls back to password when SSO is unavailable', () => {
    const passwordFlow = flow([AuthType.Password]);

    expect(pickUIAFlow([passwordFlow])).toBe(passwordFlow);
  });

  it('falls back to first flow for supported multi-stage flows', () => {
    const combinedFlow = flow([AuthType.Password, AuthType.Sso]);

    expect(pickUIAFlow([combinedFlow])).toBe(combinedFlow);
  });

  it('returns undefined when there are no flows', () => {
    expect(pickUIAFlow([])).toBeUndefined();
  });
});
