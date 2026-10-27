import { normalizeBasePath } from './src/app/utils/basePathShared';

const buildBasePath = process.env.APP_BUILD_BASE_PATH;
const normalizedBuildBasePath = buildBasePath ? normalizeBasePath(buildBasePath) : undefined;

export default {
  base: normalizedBuildBasePath
    ? normalizedBuildBasePath === '/'
      ? '/'
      : `${normalizedBuildBasePath}/`
    : './',
};
