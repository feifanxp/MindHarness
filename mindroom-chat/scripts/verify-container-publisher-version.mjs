import { readFileSync } from 'node:fs';

const publisherWorkflows = [
  '.github/workflows/docker-publish-push.yml',
  '.github/workflows/prod-deploy.yml',
];
const expectedBuildArg = ['MINDROOM_BUILD_VERSION=', '$', '{{ github.sha }}'].join('');
const expectedReleaseArg = 'MINDROOM_RELEASE_VERSION=';

for (const workflow of publisherWorkflows) {
  const source = readFileSync(new URL(`../${workflow}`, import.meta.url), 'utf8');
  if (!source.includes(expectedBuildArg)) {
    throw new Error(`${workflow} must pass the exact GitHub commit into the container build`);
  }
  if (!source.includes(expectedReleaseArg)) {
    throw new Error(`${workflow} must pass the release version into the container build`);
  }
}
