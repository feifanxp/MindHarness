import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const CI_COMMON_SCRIPT_PATH = fileURLToPath(
  new URL('../../../../ios/App/ci_scripts/ci_common.sh', import.meta.url)
);
const temporaryDirectories: string[] = [];

const writeExecutable = (path: string, content: string): void => {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
};

const runBrewInstall = (failures: number) => {
  const directory = mkdtempSync(join(tmpdir(), 'mindroom-xcode-cloud-post-clone-'));
  temporaryDirectories.push(directory);

  const attemptsPath = join(directory, 'attempts');
  const sleepsPath = join(directory, 'sleeps');
  writeFileSync(attemptsPath, '');
  writeFileSync(sleepsPath, '');
  writeExecutable(
    join(directory, 'brew'),
    [
      '#!/bin/bash',
      'set -euo pipefail',
      'printf "%s\\n" "$*" >> "$BREW_ATTEMPTS_PATH"',
      'attempt=$(wc -l < "$BREW_ATTEMPTS_PATH")',
      'if ((attempt <= BREW_FAILURES)); then',
      '  echo "simulated bottle download failure" >&2',
      '  exit 1',
      'fi',
    ].join('\n')
  );
  writeExecutable(
    join(directory, 'sleep'),
    ['#!/bin/bash', 'set -euo pipefail', 'printf "%s\\n" "$*" >> "$BREW_SLEEPS_PATH"'].join('\n')
  );

  const result = spawnSync(
    'bash',
    [
      '-c',
      'set -euo pipefail; source "$1"; brew_install_with_retry "$2"',
      'bash',
      CI_COMMON_SCRIPT_PATH,
      'node',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}:/usr/bin:/bin`,
        BREW_ATTEMPTS_PATH: attemptsPath,
        BREW_FAILURES: String(failures),
        BREW_SLEEPS_PATH: sleepsPath,
      },
    }
  );

  return {
    ...result,
    attempts: readFileSync(attemptsPath, 'utf8').trim().split('\n').filter(Boolean),
    sleeps: readFileSync(sleepsPath, 'utf8').trim().split('\n').filter(Boolean),
  };
};

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { recursive: true, force: true });
  });
});

describe('Xcode Cloud post-clone Homebrew installs', () => {
  it('does not retry a successful install', () => {
    const result = runBrewInstall(0);

    expect(result.status).toBe(0);
    expect(result.attempts).toEqual(['install node']);
    expect(result.sleeps).toEqual([]);
    expect(result.stderr).not.toContain('retrying');
  });

  it('retries a transient bottle download failure', () => {
    const result = runBrewInstall(1);

    expect(result.status).toBe(0);
    expect(result.attempts).toEqual(['install node', 'install node']);
    expect(result.sleeps).toEqual(['5']);
    expect(result.stderr).toContain(
      'Warning: brew install node failed (attempt 1/3); retrying in 5 seconds.'
    );
  });

  it('fails after the bounded retry budget is exhausted', () => {
    const result = runBrewInstall(3);

    expect(result.status).not.toBe(0);
    expect(result.attempts).toEqual(['install node', 'install node', 'install node']);
    expect(result.sleeps).toEqual(['5', '10']);
    expect(result.stderr).toContain('Error: brew install node failed after 3 attempts.');
  });
});
