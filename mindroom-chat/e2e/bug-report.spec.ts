import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, getSecondaryCredentials } from './env';
import {
  expectLoggedInShellStable,
  loginWithPassword,
  setFullInterfaceModeForCredentials,
} from './helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from './helpers/browserDiagnostics';
import {
  createPrivateRoom,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
} from './helpers/matrix';

type ReportSummary = {
  body?: string;
  'io.mindroom.bug_report'?: { event_id?: string; room_id?: string };
};

type ThreadRelations = {
  chunk: Array<{ content: { msgtype?: string; body?: string; url?: string } }>;
};

// The client reads report admins from the well-known of the user's server name
// (`matrix.localhost`), which does not resolve in the Docker stack.
const serveBugReportWellKnown = async (
  context: BrowserContext,
  homeserver: string,
  admin: string
) => {
  await context.route('**/.well-known/matrix/client', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        'm.homeserver': { base_url: homeserver },
        'io.mindroom.bug_reports': { admins: [admin] },
      }),
    })
  );
};

const openedRoomId = (page: Page) => decodeURIComponent(new URL(page.url()).pathname);
const openedThreadId = (page: Page) => new URL(page.url()).searchParams.get('threadId');

test('one click sends a bug report the administrator receives without accepting an invite', async ({
  browser,
}) => {
  const adminCredentials = getSecondaryCredentials();
  test.skip(
    !adminCredentials,
    'Set E2E_SECOND_USERNAME and E2E_SECOND_PASSWORD to run the bug report e2e flow.'
  );
  test.slow();
  const homeserver = getHomeserver();
  const reporterCredentials = getPrimaryCredentials();
  const reporter = await loginToMatrix(
    homeserver,
    reporterCredentials.username,
    reporterCredentials.password
  );
  const admin = await loginToMatrix(
    homeserver,
    adminCredentials!.username,
    adminCredentials!.password
  );
  await Promise.all([
    setFullInterfaceModeForCredentials(homeserver, reporterCredentials),
    setFullInterfaceModeForCredentials(homeserver, adminCredentials!),
  ]);

  // A private room the administrator is NOT in: the report must still reach them.
  const marker = `bug report e2e ${Date.now()}`;
  const sourceRoomId = await createPrivateRoom(homeserver, reporter.accessToken, {
    name: `Bug report source ${Date.now()}`,
    topic: 'Live fixture for one-click bug reports.',
  });
  const markerEventId = await sendRoomMessage(
    homeserver,
    reporter.accessToken,
    sourceRoomId,
    { msgtype: 'm.text', body: marker },
    'bug-report-e2e'
  );

  let adminContext: BrowserContext | undefined;
  let reporterContext: BrowserContext | undefined;
  try {
    // The administrator signs in first so its client is running when the invite arrives.
    adminContext = await browser.newContext();
    await serveBugReportWellKnown(adminContext, homeserver, admin.userId);
    const adminPage = await adminContext.newPage();
    const adminDiagnostics = attachBrowserDiagnostics(adminPage);
    await loginWithPassword(adminPage, { homeserver, ...adminCredentials! });
    await expectLoggedInShellStable(adminPage);

    reporterContext = await browser.newContext();
    await serveBugReportWellKnown(reporterContext, homeserver, admin.userId);
    const reporterPage = await reporterContext.newPage();
    const reporterDiagnostics = attachBrowserDiagnostics(reporterPage);
    await loginWithPassword(reporterPage, { homeserver, ...reporterCredentials });
    await expectLoggedInShellStable(reporterPage);
    // Classic view renders the source message as a plain timeline row with the message menu.
    await seedRoomOverviewState({
      page: reporterPage,
      roomId: sourceRoomId,
      userId: reporter.userId,
      viewMode: 'classic',
    });

    const reportMarkerMessage = async () => {
      await reporterPage.goto(`/home/${encodeURIComponent(sourceRoomId)}`);
      const row = reporterPage.locator(`[data-message-id="${markerEventId}"]`);
      await row.getByText(marker).click({ button: 'right' });
      await reporterPage.getByRole('button', { name: 'Report a bug', exact: true }).click();
      // The reporter lands in the report thread with the summary and the attached JSON.
      await expect.poll(() => openedThreadId(reporterPage)).not.toBeNull();
      await expect(reporterPage.getByText(/Bug report from/).first()).toBeVisible();
      await expect(reporterPage.getByText(/mindroom-bug-report-.*\.json/).first()).toBeVisible();
      return openedThreadId(reporterPage)!;
    };

    const firstThreadId = await reportMarkerMessage();

    // The report room is recorded in account data, opened, typed, and unencrypted.
    const { room_id: reportRoomId } = await matrixFetch<{ room_id: string }>(
      homeserver,
      `/user/${encodeURIComponent(reporter.userId)}/account_data/io.mindroom.bug_reports`,
      { accessToken: reporter.accessToken }
    );
    expect(openedRoomId(reporterPage)).toContain(reportRoomId);
    const create = await matrixFetch<{ type?: string }>(
      homeserver,
      `/rooms/${encodeURIComponent(reportRoomId)}/state/m.room.create/`,
      { accessToken: reporter.accessToken }
    );
    expect(create.type).toBe('io.mindroom.bug_reports');
    const encryption = await matrixFetch(
      homeserver,
      `/rooms/${encodeURIComponent(reportRoomId)}/state/m.room.encryption/`,
      { accessToken: reporter.accessToken }
    ).then(
      () => 'present',
      (error: Error) => error.message
    );
    expect(encryption).toMatch(/Matrix API 404 .*M_NOT_FOUND/);

    // The thread root summarises the reported message; the thread carries the uploaded JSON.
    const summary = await matrixFetch<{ content: ReportSummary }>(
      homeserver,
      `/rooms/${encodeURIComponent(reportRoomId)}/event/${encodeURIComponent(firstThreadId)}`,
      { accessToken: reporter.accessToken }
    );
    expect(summary.content.body).toMatch(/^Bug report from /);
    expect(summary.content['io.mindroom.bug_report']).toMatchObject({
      room_id: sourceRoomId,
      event_id: markerEventId,
    });
    const { chunk: threadEvents } = await matrixFetch<ThreadRelations>(
      homeserver,
      `/rooms/${encodeURIComponent(reportRoomId)}/relations/${encodeURIComponent(
        firstThreadId
      )}/m.thread`,
      { accessToken: reporter.accessToken, apiVersion: 'v1' }
    );
    const reportFile = threadEvents.find((event) => event.content.msgtype === 'm.file');
    expect(reportFile?.content.body).toMatch(/^mindroom-bug-report-.*\.json$/);
    const uploaded = await matrixFetch<{ target?: { eventId?: string } }>(
      homeserver,
      `/media/download/${reportFile!.content.url!.slice('mxc://'.length)}`,
      { accessToken: reporter.accessToken, apiVersion: 'v1' }
    );
    expect(uploaded.target?.eventId).toBe(markerEventId);

    // The administrator's running client joined the report room unprompted.
    await expect
      .poll(
        async () => {
          const { joined_rooms: joinedRooms } = await matrixFetch<{ joined_rooms: string[] }>(
            homeserver,
            '/joined_rooms',
            { accessToken: admin.accessToken }
          );
          return joinedRooms.includes(reportRoomId);
        },
        { timeout: 30_000 }
      )
      .toBe(true);

    // The administrator can read the first report.
    const adminSummary = await matrixFetch<{ content: ReportSummary }>(
      homeserver,
      `/rooms/${encodeURIComponent(reportRoomId)}/event/${encodeURIComponent(firstThreadId)}`,
      { accessToken: admin.accessToken }
    );
    expect(adminSummary.content['io.mindroom.bug_report']).toMatchObject({
      room_id: sourceRoomId,
      event_id: markerEventId,
    });

    // A second report reuses the same room in a new thread.
    const secondThreadId = await reportMarkerMessage();
    expect(secondThreadId).not.toBe(firstThreadId);
    expect(openedRoomId(reporterPage)).toContain(reportRoomId);
    const reused = await matrixFetch<{ room_id: string }>(
      homeserver,
      `/user/${encodeURIComponent(reporter.userId)}/account_data/io.mindroom.bug_reports`,
      { accessToken: reporter.accessToken }
    );
    expect(reused.room_id).toBe(reportRoomId);

    const bugReportWarnings = [
      ...reporterDiagnostics.consoleWarnings,
      ...adminDiagnostics.consoleWarnings,
    ].filter((message) => message.includes('[bug-report]'));
    expect(bugReportWarnings).toEqual([]);
    await expectNoUnexpectedBrowserDiagnostics(reporterDiagnostics, 'bug report reporter');
    await expectNoUnexpectedBrowserDiagnostics(adminDiagnostics, 'bug report admin');
  } finally {
    await reporterContext?.close();
    await adminContext?.close();
  }
});
