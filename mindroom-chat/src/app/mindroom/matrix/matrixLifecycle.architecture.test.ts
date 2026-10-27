import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const matrixRoot = dirname(fileURLToPath(import.meta.url));
const lifecycleModules = [
  'cryptoStoreContinuity.ts',
  'clientSyncPolicy.ts',
  'browserStorageCleanup.ts',
  'sessionLifecycle.ts',
];

const relativeImports = (path: string): string[] => {
  const sourceFile = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  return sourceFile.statements.flatMap((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.startsWith('.')
    ) {
      return [];
    }
    return [resolve(dirname(path), statement.moduleSpecifier.text)];
  });
};

describe('Matrix lifecycle module boundaries', () => {
  it('keeps fork lifecycle modules independent from the upstream startup orchestrator', () => {
    const modulePaths = lifecycleModules.map((name) => resolve(matrixRoot, name));
    expect(modulePaths.every((path) => existsSync(path))).toBe(true);

    const orchestratorPath = resolve(matrixRoot, '../../../client/initMatrix');
    const offenders = modulePaths.flatMap((path) =>
      relativeImports(path).includes(orchestratorPath) ? [path] : []
    );

    expect(offenders).toEqual([]);
  });
});
