import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const sourceRoots = [
  'src/app/mindroom/cross-room-threads',
  'src/app/pages/client/threads',
  'src/app/pages/client/sidebar/ThreadsTab.tsx',
  'src/app/hooks/router/useThreadsSelected.ts',
  'src/app/pages/MobileFriendly.tsx',
];

const readSources = (): Map<string, ts.SourceFile> => {
  const sources = new Map<string, ts.SourceFile>();

  const visit = (path: string) => {
    if (path.includes('/__tests__/')) return;
    const absolutePath = resolve(process.cwd(), path);
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      readdirSync(absolutePath).forEach((child) => visit(join(path, child)));
      return;
    }
    if (!/\.(ts|tsx)$/.test(path)) return;
    sources.set(
      relative(process.cwd(), absolutePath),
      ts.createSourceFile(
        absolutePath,
        readFileSync(absolutePath, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        absolutePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      )
    );
  };

  sourceRoots.forEach(visit);
  return sources;
};

describe('cross-room Threads architecture', () => {
  it('does not introduce PWA reload or browser lifecycle hazards', () => {
    const forbiddenTokens = new Set([
      'beforeunload',
      'blockStandaloneWebApp',
      'MindroomBackRouteHandler',
      'pagehide',
      'reload',
      'service-worker',
      'serviceWorker',
      'unload',
    ]);
    const offenders: string[] = [];

    for (const [path, sourceFile] of readSources()) {
      const visit = (node: ts.Node) => {
        if ((ts.isIdentifier(node) || ts.isStringLiteral(node)) && forbiddenTokens.has(node.text)) {
          offenders.push(`${path}: ${node.text}`);
        }
        if (
          ts.isJsxAttribute(node) &&
          node.name.text === 'type' &&
          node.initializer &&
          ts.isStringLiteral(node.initializer) &&
          node.initializer.text === 'file'
        ) {
          offenders.push(`${path}: type=file`);
        }
        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    }

    expect(offenders).toEqual([]);
  });
});
