#!/usr/bin/env node
import { existsSync, copyFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const [, , _basePath, currentPath, otherPath, repoPath] = process.argv;

if (!currentPath || !otherPath) {
  console.error('Usage: git-merge-mindroom-wrapper <base> <current> <other> <path>');
  process.exit(2);
}

const findGitDir = (startDir) => {
  let dir = startDir;
  while (true) {
    const dotGit = path.join(dir, '.git');
    if (existsSync(dotGit)) {
      try {
        const stat = readFileSync(dotGit, 'utf8');
        const match = stat.match(/^gitdir:\s*(.+)$/m);
        if (match) {
          return path.resolve(dir, match[1].trim());
        }
      } catch {
        return dotGit;
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
};

const gitDir = findGitDir(process.cwd());
const isRebase =
  process.env.GIT_REFLOG_ACTION?.includes('rebase') ||
  (gitDir !== undefined &&
    (existsSync(path.join(gitDir, 'rebase-merge')) ||
      existsSync(path.join(gitDir, 'rebase-apply'))));

if (isRebase) {
  copyFileSync(otherPath, currentPath);
  console.error(
    `MindRoom wrapper merge driver kept rebased fork side for ${repoPath ?? currentPath}`
  );
} else {
  console.error(`MindRoom wrapper merge driver kept current side for ${repoPath ?? currentPath}`);
}
