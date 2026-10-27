import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const dependencies = (path: string): Set<string> => {
  const sourceFile = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const resolved = new Set<string>();

  sourceFile.statements.forEach((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.startsWith('.')
    ) {
      return;
    }
    const base = resolve(dirname(path), statement.moduleSpecifier.text);
    const target = [base, `${base}.ts`, `${base}.tsx`].find(
      (candidate) => existsSync(candidate) && statSync(candidate).isFile()
    );
    if (target) resolved.add(target);
  });

  return resolved;
};

describe('MindRoom custom HTML ownership', () => {
  it('exposes sanitizer and renderer policy through narrow generic seams', () => {
    const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const sanitizeDependencies = dependencies(resolve(appRoot, 'utils/sanitize.ts'));
    const parserDependencies = dependencies(
      resolve(appRoot, 'plugins/react-custom-html-parser.tsx')
    );

    expect(sanitizeDependencies).toContain(resolve(appRoot, 'mindroom/html/customHtmlPolicy.ts'));
    expect(parserDependencies).toContain(resolve(appRoot, 'mindroom/html/customHtmlRenderers.tsx'));
  });
});
