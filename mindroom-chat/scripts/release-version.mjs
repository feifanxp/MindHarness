import { readReleaseVersion } from './build-version.mjs';

// Prints the release version for builds that cannot run Git themselves, such
// as Docker builds whose context excludes `.git`.
process.stdout.write(`${readReleaseVersion(process.env, process.cwd())}\n`);
