#!/usr/bin/env node
import {
  existsSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  watch,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = fileURLToPath(import.meta.url);
const defaultDerivedDataPath = join(tmpdir(), 'mindroom-chat-ios-phone-derived-data');
const lockPath = join(tmpdir(), 'mindroom-chat-ios-phone.lock');
const watcherPidPath = join(tmpdir(), 'mindroom-chat-ios-phone-watch.pid');
const watcherLogPath = join(tmpdir(), 'mindroom-chat-ios-phone-watch.log');
const activeChildProcesses = new Set();
let activeLockRelease;

const parseArgs = () => {
  const options = {
    watch: false,
    launch: process.env.IOS_LAUNCH !== '0',
    deviceId: process.env.IOS_DEVICE_ID,
    derivedDataPath: process.env.IOS_DERIVED_DATA || defaultDerivedDataPath,
    background: false,
    stop: false,
    initial: true,
  };

  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--watch' || arg === '-w') {
      options.watch = true;
      continue;
    }

    if (arg === '--background') {
      options.background = true;
      continue;
    }

    if (arg === '--stop') {
      options.stop = true;
      continue;
    }

    if (arg === '--no-initial') {
      options.initial = false;
      continue;
    }

    if (arg === '--no-launch') {
      options.launch = false;
      continue;
    }

    if (arg === '--device') {
      options.deviceId = args[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith('--device=')) {
      options.deviceId = arg.slice('--device='.length);
      continue;
    }

    if (arg === '--derived-data') {
      options.derivedDataPath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith('--derived-data=')) {
      options.derivedDataPath = arg.slice('--derived-data='.length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  options.derivedDataPath = resolve(repoRoot, options.derivedDataPath);
  return options;
};

const printStep = (message) => {
  process.stdout.write(`\n==> ${message}\n`);
};

const quote = (value) => (/\s/.test(value) ? JSON.stringify(value) : value);

const terminateChildProcess = (child, signal = 'SIGTERM') => {
  if (!child.pid) return;

  try {
    process.kill(-child.pid, signal);
    return;
  } catch {
    // Fall back to the direct child if process-group termination is unavailable.
  }

  try {
    child.kill(signal);
  } catch {
    // Best-effort cleanup only.
  }
};

const terminateActiveChildren = () => {
  for (const child of activeChildProcesses) {
    terminateChildProcess(child);
  }
};

const run = (command, args, options = {}) =>
  new Promise((resolveRun, rejectRun) => {
    process.stdout.write(`$ ${[command, ...args].map(quote).join(' ')}\n`);
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
      detached: true,
    });
    activeChildProcesses.add(child);

    child.on('error', (error) => {
      activeChildProcesses.delete(child);
      rejectRun(error);
    });
    child.on('close', (code, signal) => {
      activeChildProcesses.delete(child);
      if (code === 0) {
        resolveRun();
        return;
      }

      const detail = signal ? `signal ${signal}` : `exit code ${code}`;
      const error = new Error(`${command} failed with ${detail}`);
      if (options.allowFailure) {
        process.stderr.write(`warning: ${error.message}\n`);
        resolveRun();
        return;
      }
      rejectRun(error);
    });
  });

const spawnBackgroundWatcher = (options) => {
  let existingPid;
  try {
    existingPid = Number(readFileSync(watcherPidPath, 'utf8').trim());
  } catch {
    existingPid = undefined;
  }

  if (existingPid && processIsRunning(existingPid)) {
    process.stdout.write(`iOS phone watcher is already running as PID ${existingPid}.\n`);
    process.stdout.write(`Log: ${watcherLogPath}\n`);
    return;
  }

  rmSync(watcherPidPath, { force: true });
  const logFd = openSync(watcherLogPath, 'a');
  const args = [scriptPath, '--watch', '--no-initial', '--derived-data', options.derivedDataPath];
  if (!options.launch) args.push('--no-launch');
  if (options.deviceId) args.push('--device', options.deviceId);

  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: process.env,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  closeSync(logFd);
  child.unref();

  writeFileSync(watcherPidPath, `${child.pid}\n`);
  process.stdout.write(`Started iOS phone watcher as PID ${child.pid}.\n`);
  process.stdout.write(`Log: ${watcherLogPath}\n`);
};

const stopBackgroundWatcher = () => {
  let pid;
  try {
    pid = Number(readFileSync(watcherPidPath, 'utf8').trim());
  } catch {
    process.stdout.write('No iOS phone watcher PID file found.\n');
    return;
  }

  if (!pid || !processIsRunning(pid)) {
    rmSync(watcherPidPath, { force: true });
    process.stdout.write('No running iOS phone watcher found.\n');
    return;
  }

  process.kill(pid, 'SIGTERM');
  rmSync(watcherPidPath, { force: true });
  process.stdout.write(`Stopped iOS phone watcher PID ${pid}.\n`);
};

const processIsRunning = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const acquireLock = () => {
  try {
    const fd = openSync(lockPath, 'wx');
    writeFileSync(fd, `${process.pid}\n`);
    closeSync(fd);
    return () => {
      try {
        rmSync(lockPath, { force: true });
      } catch {
        // Best-effort cleanup only.
      }
    };
  } catch {
    let existingPid;
    try {
      existingPid = Number(readFileSync(lockPath, 'utf8').trim());
    } catch {
      existingPid = undefined;
    }

    if (existingPid && processIsRunning(existingPid)) {
      throw new Error(
        `Another ios:phone run is active as PID ${existingPid}. Stop it or wait for it to finish.`
      );
    }

    rmSync(lockPath, { force: true });
    return acquireLock();
  }
};

const parseDeviceLine = (line) => {
  const columns = line.trim().split(/\s{2,}/);
  if (columns.length < 5) return undefined;

  const [name, hostname, identifier, state, model] = columns;
  return { name, hostname, identifier, state, model };
};

const listDevices = () => {
  const result = spawnSync('xcrun', ['devicectl', 'list', 'devices'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;

  if (result.status !== 0 && !output) {
    throw new Error('Unable to list CoreDevice devices with xcrun devicectl.');
  }

  return output.split('\n').map(parseDeviceLine).filter(Boolean);
};

const resolveDeviceId = (explicitDeviceId) => {
  if (explicitDeviceId) return explicitDeviceId;

  const devices = listDevices();
  const installableStates = new Set(['available (paired)', 'connected']);
  const installableIphones = devices.filter(
    (device) => installableStates.has(device.state) && /\biPhone\b/.test(device.model)
  );

  if (installableIphones.length === 1) {
    const [device] = installableIphones;
    process.stdout.write(`Using iOS device ${device.name} (${device.identifier}).\n`);
    return device.identifier;
  }

  if (installableIphones.length > 1) {
    const choices = installableIphones
      .map((device) => `  ${device.identifier}  ${device.name}  ${device.state}  ${device.model}`)
      .join('\n');
    throw new Error(
      `Multiple installable iPhones found. Set IOS_DEVICE_ID or pass --device:\n${choices}`
    );
  }

  const knownDevices = devices
    .filter((device) => /\biPhone\b/.test(device.model))
    .map((device) => `  ${device.identifier}  ${device.name}  ${device.state}  ${device.model}`)
    .join('\n');
  throw new Error(
    `No connected or available paired iPhone found. Unlock the phone and keep it on the same network.\n${knownDevices}`
  );
};

const appPathFor = (derivedDataPath) =>
  join(derivedDataPath, 'Build/Products/Debug-iphoneos/App.app');

const runOnce = async (options) => {
  const releaseLock = acquireLock();
  activeLockRelease = releaseLock;
  try {
    const deviceId = resolveDeviceId(options.deviceId);

    printStep('Building web app');
    await run('npm', ['run', 'build:ios']);

    printStep('Syncing Capacitor iOS project');
    await run('npx', ['cap', 'sync', 'ios']);

    printStep('Building signed iOS app');
    await run('xcodebuild', [
      '-workspace',
      'ios/App/App.xcworkspace',
      '-scheme',
      'App',
      '-configuration',
      'Debug',
      '-destination',
      'generic/platform=iOS',
      '-derivedDataPath',
      options.derivedDataPath,
      '-allowProvisioningUpdates',
      'build',
    ]);

    const appPath = appPathFor(options.derivedDataPath);
    if (!existsSync(appPath)) {
      throw new Error(`Expected built app was not found at ${appPath}`);
    }

    printStep(`Installing app on ${deviceId}`);
    await run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', deviceId, appPath]);

    if (options.launch) {
      printStep('Launching app');
      await run(
        'xcrun',
        ['devicectl', 'device', 'process', 'launch', '--device', deviceId, 'chat.mindroom.app'],
        { allowFailure: true }
      );
    }
  } finally {
    activeLockRelease = undefined;
    releaseLock();
  }
};

const existingWatchTargets = () => {
  const targets = [
    'src',
    'public',
    'index.html',
    'config.mindroom.json',
    'config.mindroom.ios.json',
    'scripts/ios-client-config.mjs',
    'capacitor.config.ts',
    'package.json',
    'package-lock.json',
    'vite.config.js',
    'vite.config.ts',
    'vite.config.mts',
    'tsconfig.json',
    'tsconfig.node.json',
    'ios/App/App/AppDelegate.swift',
    'ios/App/App/Info.plist',
    'ios/App/App/App.entitlements',
    'ios/App/Podfile',
  ];

  return targets.map((target) => join(repoRoot, target)).filter(existsSync);
};

const shouldIgnore = (path) => {
  const normalized = path.split(sep).join('/');
  return (
    normalized.includes('/node_modules/') ||
    normalized.includes('/dist/') ||
    normalized.includes('/ios/App/App/public/') ||
    normalized.includes('/ios/App/Pods/') ||
    normalized.endsWith('.swp') ||
    normalized.endsWith('~') ||
    normalized.endsWith('.tmp') ||
    normalized.endsWith('.DS_Store')
  );
};

const isDeployGeneratedWatchPath = (path) => {
  const normalized = relative(repoRoot, path).split(sep).join('/');
  return normalized === 'ios/App/Podfile' || normalized === 'ios/App/Podfile.lock';
};

const runWatch = async (options) => {
  let running = false;
  let pending = false;
  let debounceTimer;
  let shutdownRequested = false;
  let suppressDeployGeneratedUntil = 0;

  const trigger = (reason, changedPath) => {
    if (shutdownRequested) return;

    if (
      changedPath &&
      isDeployGeneratedWatchPath(changedPath) &&
      (running || Date.now() < suppressDeployGeneratedUntil)
    ) {
      process.stdout.write(
        `Ignoring deploy-generated change: ${relative(repoRoot, changedPath)}\n`
      );
      return;
    }

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(
      async () => {
        if (shutdownRequested) return;

        if (running) {
          pending = true;
          return;
        }

        running = true;
        pending = false;
        try {
          printStep(reason || 'Initial iOS phone push');
          await runOnce(options);
          process.stdout.write('\nWatching for the next change...\n');
        } catch (error) {
          process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
          process.stderr.write('Watching will continue; fix the issue and save a file to retry.\n');
        } finally {
          suppressDeployGeneratedUntil = Date.now() + 5000;
          running = false;
          if (pending) trigger('Pushing queued changes');
        }
      },
      reason ? 1500 : 0
    );
  };

  const targets = existingWatchTargets();
  const watchers = targets.map((target) => {
    const targetStats = statSync(target);
    return watch(
      target,
      {
        recursive: targetStats.isDirectory(),
      },
      (_eventType, filename) => {
        const changedPath =
          targetStats.isDirectory() && filename ? join(target, String(filename)) : target;
        if (shouldIgnore(changedPath)) return;
        trigger(`Change detected: ${relative(repoRoot, changedPath)}`, changedPath);
      }
    );
  });

  mkdirSync(options.derivedDataPath, { recursive: true });
  process.stdout.write(`Watching ${targets.length} iOS build inputs.\n`);
  process.stdout.write(`DerivedData: ${options.derivedDataPath}\n`);
  process.stdout.write('Press Ctrl-C to stop.\n');

  const shutdown = () => {
    shutdownRequested = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    watchers.forEach((watcher) => watcher.close());
    terminateActiveChildren();
    if (activeLockRelease) activeLockRelease();
    process.stdout.write('\nStopped iOS phone watcher.\n');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (options.initial) {
    trigger();
  } else {
    process.stdout.write('\nWaiting for the next change...\n');
  }
};

const main = async () => {
  const options = parseArgs();
  mkdirSync(options.derivedDataPath, { recursive: true });

  if (options.stop) {
    stopBackgroundWatcher();
    return;
  }

  if (options.background) {
    spawnBackgroundWatcher(options);
    return;
  }

  if (options.watch) {
    await runWatch(options);
    return;
  }

  await runOnce(options);
};

main().catch((error) => {
  process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
