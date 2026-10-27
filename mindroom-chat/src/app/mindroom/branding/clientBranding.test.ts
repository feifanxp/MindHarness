import { describe, expect, it } from 'vitest';

import { MINDROOM_CLIENT_BRANDING, getMindroomWelcomePageContent } from './clientBranding';

describe('clientBranding', () => {
  it('exposes client-facing MindRoom Chat defaults', () => {
    expect(MINDROOM_CLIENT_BRANDING.appName).toBe('MindRoom Chat');
    expect(MINDROOM_CLIENT_BRANDING.docsUrl).toBe('https://docs.mindroom.chat/');
    expect(MINDROOM_CLIENT_BRANDING.sourceUrl).toBe('https://github.com/mindroom-ai/mindroom-chat');
    expect(MINDROOM_CLIENT_BRANDING.logoAlt).toBe('MindRoom Chat Logo');
    expect(MINDROOM_CLIENT_BRANDING.subtitle).toBe('AI agents that live in your chat rooms.');
  });

  it('merges configured welcome content with MindRoom defaults', () => {
    expect(
      getMindroomWelcomePageContent({
        docsUrl: '',
        poweredBy: [{ label: 'Custom', url: 'https://example.test' }],
        title: 'Custom title',
      })
    ).toEqual({
      docsLabel: 'Docs',
      docsUrl: '',
      poweredBy: [{ label: 'Custom', url: 'https://example.test' }],
      sourceLabel: 'Source Code',
      sourceUrl: 'https://github.com/mindroom-ai/mindroom-chat',
      subtitle: 'AI agents that live in your chat rooms.',
      title: 'Custom title',
    });
  });

  it('localizes default copy while preserving configured overrides', () => {
    const translations: Record<string, string> = {
      'sharedUi.welcomePage.docs': 'Dokumentation',
      'sharedUi.welcomePage.sourceCode': 'Quellcode',
      'sharedUi.welcomePage.subtitle': 'Lokalisierter Untertitel',
      'sharedUi.welcomePage.title': 'Willkommen bei {{appName}}',
    };
    const t = (key: string, options?: Record<string, unknown>) =>
      (translations[key] ?? key).replace('{{appName}}', String(options?.appName ?? ''));

    expect(
      getMindroomWelcomePageContent(
        {
          docsLabel: 'Docs',
          sourceLabel: 'Source Code',
          subtitle: MINDROOM_CLIENT_BRANDING.subtitle,
          title: `Welcome to ${MINDROOM_CLIENT_BRANDING.appName}`,
        },
        t as never
      )
    ).toMatchObject({
      docsLabel: 'Dokumentation',
      sourceLabel: 'Quellcode',
      subtitle: 'Lokalisierter Untertitel',
      title: 'Willkommen bei MindRoom Chat',
    });

    expect(
      getMindroomWelcomePageContent(
        {
          docsLabel: 'Handbook',
          sourceLabel: 'Repository',
          subtitle: 'Custom subtitle',
          title: 'Custom title',
        },
        t as never
      )
    ).toMatchObject({
      docsLabel: 'Handbook',
      sourceLabel: 'Repository',
      subtitle: 'Custom subtitle',
      title: 'Custom title',
    });
  });
});
