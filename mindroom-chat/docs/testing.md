# Parallel browser tests

Use a small scheduler plus explicit service setup.
Agents should run these commands rather than recreate scheduling logic.
Prerequisites: Node from `.node-version`, Bash, Python 3, curl, Docker Compose, `npm ci`, and Playwright browsers (`npx playwright install --with-deps`).
Use Linux, macOS, or WSL; existing shell helpers need Python (`uv run --no-project` can supply it).

Start a disposable Matrix stack on an unused local port:

```sh
export COMPOSE_PROJECT_NAME=chat-e2e-$USER-$$
export E2E_MATRIX_PORT=127.0.0.1:28108
export E2E_HOMESERVER=http://127.0.0.1:28108
export E2E_HOMESERVER_PUBLIC_URL=$E2E_HOMESERVER
npm run e2e:matrix:up
npm run build
```

Keep these servers running in separate terminals from the same checkout:

```sh
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
MINDROOM_E2E_PROVISIONING_URL=http://127.0.0.1:4188 npm run start -- --host 127.0.0.1 --port 4188 --strictPort
```

The development server serves fixture pages, and the provisioning override points its Local MindRoom config at its own origin so pairing tests never reach production.

Back in the first terminal:

```sh
export E2E_BASE_URL=http://127.0.0.1:4173
export E2E_DEV_BASE_URL=http://127.0.0.1:4188
npm run test:e2e:parallel -- --list
npm run test:e2e:parallel -- --jobs 8
# Focused rerun: append exact repository-relative spec paths.
# npm run test:e2e:parallel -- --jobs 2 e2e/account-storage.spec.ts
```

The scheduler discovers every Playwright config, deduplicates shared Chromium cases, and includes supplemental Firefox/WebKit cases.
Each spec/project gets fresh accounts, a fixture room, and its own working/output directory; it reuses the existing account and seed scripts.
App Store captures intentionally reuse their existing fixed display agents, so use one suite per disposable Matrix stack.
One Playwright worker runs per spec with zero retries; timing-sensitive and special-fixture specs run sequentially after the parallel pool.
Avoid heavy competing workloads during that phase; use separate checkouts for simultaneous builds and restart Vite after changing branches.

Results and legacy screenshots stay under `test-results/parallel/<run>/`; `E2E_ARTIFACTS` overrides the parent directory.
Read `summary.json` and each job's `report.json`: platform skips remain explicit, and failed setup/tests, missing reports/cases, all-skipped jobs, or blocked integrations cause a nonzero exit.
Ctrl-C stops child process groups and exits 130; app servers and Matrix remain caller-owned.
Stop the two server terminals and run `docker compose -f e2e/docker-compose.matrix.yaml down --volumes` in the first terminal to remove its Matrix project.
Artifacts can contain disposable credentials; keep them local.

## External prerequisites

Set `E2E_SSO_HOMESERVER=https://mindroom.chat` for hosted SSO route checks.
For worker-computer coverage, follow the backend's `docs/tools/worker-computer.md` and run `scripts/test-worker-computer.py --serve --chat-origin http://127.0.0.1:4173`.
Set `E2E_COMPUTER_FIXTURE` to its `chat-fixture.json`; its loopback `ui_origin` must equal `E2E_BASE_URL`.
Start backend fixture containers before browser jobs; network changes during tests can disrupt requests.
Without these prerequisites, those jobs are reported as blocked while the rest continue.

## Linux without native browser dependencies

Run the same scheduler inside the matching official Playwright image; keep the host services above running:

```sh
image=mcr.microsoft.com/playwright:v$(node -p 'require("@playwright/test/package.json").version')-noble
docker run --rm --init --network host --ipc host --user "$(id -u):$(id -g)" \
  -v "$PWD:$PWD" -w "$PWD" -e E2E_HOMESERVER -e E2E_BASE_URL -e E2E_DEV_BASE_URL \
  -e E2E_SSO_HOMESERVER -e E2E_COMPUTER_FIXTURE "$image" node scripts/test-e2e-parallel.mjs --jobs 8
```

Keep an external worker fixture JSON inside the mounted checkout or mount its path too.
Software graphics leave rows unpainted for a frame or two during fast native flings, on static HTML too, so the compositor ride logs blank pixels and asserts row coverage where the fling lands instead.
The scheduler does not relax assertions or add retries.
Unit tests remain `npm test`; the scheduler's focused tests run through `npm run test:e2e:runner` in PR CI.

## Streaming stress fixture

With a disposable local Matrix stack running, create a dedicated account and seed 1,000 threads with 100 streamed replies each:

```sh
export E2E_HOMESERVER=http://127.0.0.1:28108
export E2E_USERNAME=mindroom_stress_disposable
: "${E2E_PASSWORD:?Set a disposable fixture password}"
export E2E_PASSWORD
# Credentials come from the environment; suppress the helper's shell exports.
uv run --no-project --python 3.12 bash scripts/ensure-e2e-account.sh E2E unused unused >/dev/null
node scripts/seed-streaming-stress-room.mjs \
  --manifest test-results/streaming-stress/manifest.json
node --test scripts/seed-streaming-stress-room.test.mjs
```

The seeder accepts only loopback homeservers and requires the existing account's `E2E_USERNAME` and `E2E_PASSWORD`; `--help` documents workload options.
Each reply sends an initial pending notice and three edits ending in a completed text message, producing 401,000 message events including the roots.
Keep the manifest and Matrix device, then rerun the same command to resume interrupted work.
Completed threads are checkpointed atomically; interrupted threads reuse stable transaction IDs without duplicating messages.
A lost room-creation response is recovered through its stable alias on the next run.
If a forced kill leaves a `.lock` file, confirm its recorded process has stopped before removing that file.
Seeding reports completed threads and expected event counts; the live probe below verifies every server thread root and reply count before sending its replay.
Historical seeding does not prove that a browser processed those edits live.

### Live Chrome replay

Run the dedicated overview probe against that complete manifest and an already-running production preview:

```sh
: "${E2E_PASSWORD:?Set the seeded fixture account password}"
E2E_NO_WEB_SERVER=1 E2E_BASE_URL=http://127.0.0.1:4173 \
  PERF_STRESS_MANIFEST=test-results/streaming-stress/manifest.json \
  npx playwright test e2e/live/perf-large-room-streaming.spec.ts \
  --project=chromium --workers=1 --retries=0 --headed \
  --output=test-results/streaming-stress/before
```

The probe uses installed Google Chrome unless `PLAYWRIGHT_CHROMIUM_EXECUTABLE` explicitly selects another executable.
It defaults to the manifest's username and loopback homeserver; any `E2E_USERNAME` or `E2E_HOMESERVER` override must match that fixture.
Without a manifest it skips; with a manifest, a missing password or incomplete fixture fails explicitly.
The parallel scheduler excludes this standalone probe because its per-job accounts cannot reuse the manifest-owned room.

Before replay, the probe checks every server thread root against the manifest and requires at least the configured reply count in each thread.
It records the actual pre-replay reply total, so repeated runs remain valid and their accumulated replies stay visible in the report.
The probe waits for every unique manifest thread card, adds one pending reply to each of the first 20 roots, and waits for all 20 previews before profiling.
It sends 20 batches of 20 replacement events with a 50 ms pause between batches, ending with completed text messages, and requires every final preview and streaming indicator to catch up.
CPU profiles and JSON reports are attached to the Playwright result, including actual send rate, catch-up time, raw frame gaps, long tasks, and browser metrics.
Timings are informational; missing cards and stale final previews fail the test.
Playwright traces, videos, and automatic screenshots are disabled so authentication is not recorded.

Each replay adds 20 logical replies and 400 edits; the manifest's 401,000 historical seed events are a separate workload, not 401,000 live edits.
Use distinct output directories for before/after runs and record accumulated replay counts, or restore an identical disposable Matrix snapshot for each run.
