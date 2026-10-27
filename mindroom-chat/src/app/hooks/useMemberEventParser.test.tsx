import React from 'react';
import { act, create } from 'react-test-renderer';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { useMemberEventParser } from './useMemberEventParser';

function MembershipMessage({ event }: { event: MatrixEvent }) {
  const parse = useMemberEventParser();
  return <div>{parse(event).body}</div>;
}

describe('localized membership events', () => {
  it('updates a whole membership sentence live while preserving the member name', async () => {
    const language = createInstance();
    await language.init({
      lng: 'en',
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
      resources: {
        en: {
          translation: {
            sharedUi: { memberEvents: { joined: '<b>{{userName}}</b> joined the room' } },
          },
        },
        de: {
          translation: {
            sharedUi: { memberEvents: { joined: '<b>{{userName}}</b> hat den Raum betreten' } },
          },
        },
      },
    });
    const event = new MatrixEvent({
      type: 'm.room.member',
      sender: '@lee:example.org',
      state_key: '@lee:example.org',
      content: { membership: 'join', displayname: 'Lee <3 & Co' },
      unsigned: { prev_content: { membership: 'invite' } },
    });
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <I18nextProvider i18n={language}>
          <MembershipMessage event={event} />
        </I18nextProvider>
      );
    });
    await act(async () => {
      await language.changeLanguage('de');
    });
    expect(JSON.stringify(renderer!.toJSON())).toContain('hat den Raum betreten');
    expect(renderer!.root.findByType('b').children).toEqual(['Lee <3 & Co']);
    act(() => renderer!.unmount());
  });
});
