import { expect, Page } from '@playwright/test';

type BrowserDiagnostics = {
  consoleErrors: string[];
  consoleWarnings: string[];
  pageErrors: string[];
  requestFailures: string[];
};

const CRITICAL_DIAGNOSTIC_PATTERNS = [
  /Unexpected Application Error!/i,
  /MatrixClient not initialized/i,
  /Maximum update depth/i,
  /the account in the store doesn't match/i,
  /Cannot access .* before initialization/i,
];

const CRITICAL_CONSOLE_WARNING_PATTERNS = [
  /Could not create thread object for/i,
  /Tried loading a regular timeline at the position of a thread event/i,
  /scheduleReconcile rejected[\s\S]*Cannot read properties of undefined[\s\S]*getTs/i,
];

const matchesPatterns = (value: string, patterns: RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(value));

export const attachBrowserDiagnostics = (page: Page): BrowserDiagnostics => {
  const diagnostics: BrowserDiagnostics = {
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    requestFailures: [],
  };

  page.on('console', (message) => {
    if (message.type() === 'error') {
      diagnostics.consoleErrors.push(message.text());
      return;
    }

    if (message.type() === 'warning') {
      diagnostics.consoleWarnings.push(message.text());
    }
  });

  page.on('pageerror', (error) => {
    diagnostics.pageErrors.push(error.message);
  });

  page.on('requestfailed', (request) => {
    diagnostics.requestFailures.push(
      `${request.method()} ${request.url()} :: ${request.failure()?.errorText ?? 'unknown'}`
    );
  });

  return diagnostics;
};

export const expectNoUnexpectedBrowserDiagnostics = async (
  diagnostics: BrowserDiagnostics,
  label: string
) => {
  const criticalConsoleErrors = diagnostics.consoleErrors.filter((message) =>
    matchesPatterns(message, CRITICAL_DIAGNOSTIC_PATTERNS)
  );
  const criticalConsoleWarnings = diagnostics.consoleWarnings.filter((message) =>
    matchesPatterns(message, CRITICAL_CONSOLE_WARNING_PATTERNS)
  );
  const criticalPageErrors = diagnostics.pageErrors.filter((message) =>
    matchesPatterns(message, CRITICAL_DIAGNOSTIC_PATTERNS)
  );
  const criticalRequestFailures = diagnostics.requestFailures.filter((message) =>
    matchesPatterns(message, CRITICAL_DIAGNOSTIC_PATTERNS)
  );

  // Keep a concise summary in the test output so live runs can be reviewed quickly.
  // eslint-disable-next-line no-console
  console.log(
    `[diag:${label}] consoleErrors=${diagnostics.consoleErrors.length} consoleWarnings=${diagnostics.consoleWarnings.length} pageErrors=${diagnostics.pageErrors.length} requestFailures=${diagnostics.requestFailures.length}`
  );

  await expect(
    {
      criticalConsoleErrors,
      criticalConsoleWarnings,
      criticalPageErrors,
      criticalRequestFailures,
    },
    `Unexpected browser diagnostics during ${label}`
  ).toEqual({
    criticalConsoleErrors: [],
    criticalConsoleWarnings: [],
    criticalPageErrors: [],
    criticalRequestFailures: [],
  });
};
