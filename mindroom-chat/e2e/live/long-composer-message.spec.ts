import { expect, test, type Locator, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createThreadFixture,
  loginToMatrix,
  matrixFetch,
  type MatrixSession,
  seedRoomOverviewState,
  setAccountData,
} from '../helpers/matrix';

test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
// One signed-in page and API session for all cases: the homeserver rate-limits logins.
test.describe.configure({ mode: 'serial' });

type RoomMessages = {
  chunk: { event_id: string; sender: string; content: Record<string, unknown> }[];
};

// About 22 KB of Markdown: short enough that the composer keeps the paste inline, but its HTML
// makes the message larger than one Matrix event can hold.
const LINE_COUNT = 300;
const message = Array.from({ length: LINE_COUNT }, (_, index) => {
  const n = index + 1;
  return `- **Point ${n}**: see \`item_${n}()\`, _note_ and [link](https://example.org/${n})`;
}).join('\n');

let session: MatrixSession;
let page: Page;
test.beforeAll(async ({ browser }) => {
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();
  session = await loginToMatrix(homeserver, credentials.username, credentials.password);
  await setAccountData(homeserver, session.accessToken, session.userId, 'io.mindroom.settings', {
    simpleMode: false,
  });
  page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await loginWithPassword(page, { homeserver, ...credentials });
});
test.afterAll(async () => {
  await page?.close();
});

const openFixture = async (surface: 'room' | 'thread') => {
  const homeserver = getHomeserver();
  const fixture = await createThreadFixture(homeserver, session.accessToken, {
    name: `Long composer message ${surface} ${Date.now()}`,
    topic: 'Local long composer message check',
    rootBody: 'Long composer message',
    replyBody: 'Short reply.',
  });

  await seedRoomOverviewState({
    page,
    roomId: fixture.roomId,
    userId: session.userId,
    viewMode: surface === 'room' ? 'classic' : 'threaded',
  });
  const roomPath = `/home/${encodeURIComponent(fixture.roomId)}`;
  await page.goto(
    surface === 'room' ? roomPath : `${roomPath}?threadId=${encodeURIComponent(fixture.rootId)}`
  );
  const timeline = surface === 'thread' ? page.locator('div[data-thread-count]') : page;
  await expect(timeline.getByText('Short reply.')).toBeVisible();
  return { fixture, timeline };
};

const sendLongMessage = async (timeline: Page | Locator) => {
  const composer = page.getByRole('textbox').first();
  await composer.click();
  await composer.evaluate((editor, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    editor.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
    );
  }, message);
  await expect(composer).toContainText(`Point ${LINE_COUNT}`);
  await page.getByRole('button', { name: 'Send message' }).click();

  // The message is confirmed by the server, and its full text replaces the preview.
  const ownRow = timeline.locator('[data-message-id^="$"]').filter({ hasText: 'Point 1:' });
  await expect(ownRow).toContainText(`item_${LINE_COUNT}()`);
  await expect(composer).not.toContainText('Point 1');
  return { composer, ownRow };
};

const latestOwnEvents = async (roomId: string) =>
  (
    await matrixFetch<RoomMessages>(
      getHomeserver(),
      `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=10`,
      { accessToken: session.accessToken }
    )
  ).chunk.filter((event) => event.sender === session.userId);

for (const surface of ['room', 'thread'] as const) {
  test(`${surface}: a pasted message too large for one event is sent whole`, async () => {
    const { fixture, timeline } = await openFixture(surface);
    await sendLongMessage(timeline);

    // The server holds a preview that points at the file with the whole message.
    const sent = (await latestOwnEvents(fixture.roomId)).find(
      (event) => event.content.msgtype === 'm.file'
    );
    expect(sent?.content).toMatchObject({
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
      ...(surface === 'thread'
        ? { 'm.relates_to': { rel_type: 'm.thread', event_id: fixture.rootId } }
        : {}),
    });
  });
}

test('room: a long message you sent is edited from its whole text', async () => {
  const { fixture, timeline } = await openFixture('room');
  const { composer, ownRow } = await sendLongMessage(timeline);

  // The editor opens with the whole message, not the preview the event carries.
  await composer.press('ArrowUp');
  const editBox = page.locator('[contenteditable="true"]').filter({ hasText: 'Point 1' });
  await expect(editBox).toBeFocused();
  await expect(editBox).toContainText(`item_${LINE_COUNT}()`);
  await editBox.press('Control+End');
  await page.keyboard.insertText(' Edited at the end');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await expect(ownRow).toContainText('Edited at the end');

  // Too large for one event, the edit replaces the message with a new long-text file.
  const edit = (await latestOwnEvents(fixture.roomId)).find(
    (event) => (event.content['m.relates_to'] as { rel_type?: string })?.rel_type === 'm.replace'
  );
  const replacement = edit?.content['m.new_content'] as Record<string, unknown>;
  expect(replacement).toMatchObject({
    msgtype: 'm.file',
    'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
  });
  // The file holds the whole edit, the shape MindRoom reads: the edited text is its `m.new_content`.
  const [server, mediaId] = (replacement.url as string).slice('mxc://'.length).split('/');
  const file = await matrixFetch<Record<string, Record<string, unknown>>>(
    getHomeserver(),
    `/media/download/${server}/${mediaId}`,
    { accessToken: session.accessToken, apiVersion: 'v1' }
  );
  expect(file['m.new_content'].body).toMatch(/Edited at the end$/);

  // The next edit starts from the edited whole text, and a short one is sent as plain text.
  await composer.press('ArrowUp');
  await expect(editBox).toBeFocused();
  await expect(editBox).toContainText('Edited at the end');
  await editBox.fill('Short now');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  const shortRow = timeline.locator('[data-message-id^="$"]').filter({ hasText: 'Short now' });
  await expect(shortRow).toBeVisible();
  await expect(shortRow).not.toContainText('Point 1');
  const shortEdit = (await latestOwnEvents(fixture.roomId)).find(
    (event) => (event.content['m.new_content'] as { body?: string })?.body === 'Short now'
  );
  expect(shortEdit?.content['m.new_content']).toEqual({
    msgtype: 'm.text',
    body: 'Short now',
    'm.mentions': {},
  });
});
