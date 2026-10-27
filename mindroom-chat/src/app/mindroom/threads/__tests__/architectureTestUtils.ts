import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

export const APP_ROOT = resolve(TEST_DIR, '../../..');
export const MINDROOM_ROOT = resolve(APP_ROOT, 'mindroom');
export const REPO_ROOT = resolve(APP_ROOT, '../..');

export const appFile = (relativePath: string): string => resolve(APP_ROOT, relativePath);
export const mindroomFile = (relativePath: string): string => resolve(MINDROOM_ROOT, relativePath);
export const repoFile = (relativePath: string): string => resolve(REPO_ROOT, relativePath);

export const pathExists = (path: string): boolean => existsSync(path);
export const readSource = (path: string): string => readFileSync(path, 'utf8');

export const parseSourceFile = (path: string): ts.SourceFile =>
  ts.createSourceFile(
    path,
    readSource(path),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

export type ModuleDependency = {
  specifier: string;
  kind: 'import' | 'export' | 'dynamic-import' | 'require' | 'import-type';
  typeOnly: boolean;
};

const allNamedImportsAreTypeOnly = (clause: ts.ImportClause): boolean =>
  clause.name === undefined &&
  clause.namedBindings !== undefined &&
  ts.isNamedImports(clause.namedBindings) &&
  clause.namedBindings.elements.length > 0 &&
  clause.namedBindings.elements.every((element) => element.isTypeOnly);

const allNamedExportsAreTypeOnly = (clause: ts.NamedExportBindings | undefined): boolean =>
  clause !== undefined &&
  ts.isNamedExports(clause) &&
  clause.elements.length > 0 &&
  clause.elements.every((element) => element.isTypeOnly);

export const moduleDependencies = (path: string): ModuleDependency[] => {
  const sourceFile = parseSourceFile(path);
  const dependencies: ModuleDependency[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      dependencies.push({
        specifier: node.moduleSpecifier.text,
        kind: 'import',
        typeOnly:
          node.importClause?.isTypeOnly === true ||
          (node.importClause !== undefined && allNamedImportsAreTypeOnly(node.importClause)),
      });
    }

    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      dependencies.push({
        specifier: node.moduleSpecifier.text,
        kind: 'export',
        typeOnly: node.isTypeOnly || allNamedExportsAreTypeOnly(node.exportClause),
      });
    }

    if (
      ts.isCallExpression(node) &&
      node.arguments.length >= 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      dependencies.push({
        specifier: node.arguments[0].text,
        kind: node.expression.kind === ts.SyntaxKind.ImportKeyword ? 'dynamic-import' : 'require',
        typeOnly: false,
      });
    }

    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      dependencies.push({
        specifier: node.argument.literal.text,
        kind: 'import-type',
        typeOnly: true,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return dependencies;
};

export const moduleSpecifiers = (path: string): string[] =>
  moduleDependencies(path).map((dependency) => dependency.specifier);

export const isReExportOnlyModule = (path: string): boolean => {
  const sourceFile = parseSourceFile(path);
  return (
    sourceFile.statements.length > 0 &&
    sourceFile.statements.every(
      (statement) =>
        ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier !== undefined &&
        ts.isStringLiteral(statement.moduleSpecifier)
    )
  );
};

const resolveRelativeModule = (fromFile: string, specifier: string): string | undefined => {
  if (!specifier.startsWith('.')) return undefined;

  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.d.ts`,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    resolve(base, 'index.d.ts'),
    resolve(base, 'index.ts'),
    resolve(base, 'index.tsx'),
    resolve(base, 'index.js'),
    resolve(base, 'index.jsx'),
  ];

  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
};

const requiresTypeScriptResolution = (specifier: string): boolean => {
  const extension = extname(specifier);
  return extension === '' || ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(extension);
};

export const resolvedDependencies = (
  path: string,
  options: { includeTypeOnly?: boolean } = {}
): Set<string> => {
  const includeTypeOnly = options.includeTypeOnly ?? true;
  const dependencies = new Set<string>();
  for (const dependency of moduleDependencies(path)) {
    if (!includeTypeOnly && dependency.typeOnly) continue;
    const resolved = resolveRelativeModule(path, dependency.specifier);
    if (resolved) {
      dependencies.add(resolved);
      continue;
    }
    if (
      dependency.specifier.startsWith('.') &&
      requiresTypeScriptResolution(dependency.specifier)
    ) {
      throw new Error(
        'Cannot resolve local TypeScript module ' + dependency.specifier + ' imported by ' + path
      );
    }
  }
  return dependencies;
};

export type MemberAccess = {
  name: string;
  kind: 'read' | 'write' | 'call';
};

const accessedMemberName = (node: ts.Node): string | undefined => {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression &&
    (ts.isStringLiteral(node.argumentExpression) ||
      ts.isNoSubstitutionTemplateLiteral(node.argumentExpression))
  ) {
    return node.argumentExpression.text;
  }
  return undefined;
};

const memberAccessKind = (node: ts.Node): MemberAccess['kind'] => {
  const parent = node.parent;
  if (ts.isCallExpression(parent) && parent.expression === node) return 'call';
  if (
    ts.isBinaryExpression(parent) &&
    parent.left === node &&
    parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  ) {
    return 'write';
  }
  if (
    (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
    (parent.operator === ts.SyntaxKind.PlusPlusToken ||
      parent.operator === ts.SyntaxKind.MinusMinusToken)
  ) {
    return 'write';
  }
  return 'read';
};

export const memberAccesses = (path: string): MemberAccess[] => {
  const accesses: MemberAccess[] = [];
  const visit = (node: ts.Node) => {
    const name = accessedMemberName(node);
    if (name !== undefined) accesses.push({ name, kind: memberAccessKind(node) });
    ts.forEachChild(node, visit);
  };
  visit(parseSourceFile(path));
  return accesses;
};

export const findDependencyCycles = (files: string[]): string[][] => {
  const scopedFiles = [...new Set(files.map((file) => resolve(file)))].sort();
  const scope = new Set(scopedFiles);
  const graph = new Map(
    scopedFiles.map((file) => [
      file,
      [...resolvedDependencies(file, { includeTypeOnly: false })]
        .filter((dependency) => scope.has(dependency))
        .sort(),
    ])
  );
  const state = new Map<string, 'visiting' | 'visited'>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const cycleKeys = new Set<string>();

  const visit = (file: string) => {
    state.set(file, 'visiting');
    stack.push(file);
    for (const dependency of graph.get(file) ?? []) {
      if (state.get(dependency) === 'visiting') {
        const start = stack.indexOf(dependency);
        const cycle = [...stack.slice(start), dependency];
        const key = cycle.join('\0');
        if (!cycleKeys.has(key)) {
          cycleKeys.add(key);
          cycles.push(cycle);
        }
      } else if (state.get(dependency) !== 'visited') {
        visit(dependency);
      }
    }
    stack.pop();
    state.set(file, 'visited');
  };

  scopedFiles.forEach((file) => {
    if (!state.has(file)) visit(file);
  });
  return cycles;
};

export const calledMemberNames = (path: string): Set<string> => {
  const sourceFile = parseSourceFile(path);
  const names = new Set<string>();

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) names.add(node.expression.text);
      if (ts.isPropertyAccessExpression(node.expression)) names.add(node.expression.name.text);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return names;
};

export const calledIdentifierNames = (path: string): string[] => {
  const names: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      names.push(node.expression.text);
    }
    ts.forEachChild(node, visit);
  };

  visit(parseSourceFile(path));
  return names;
};

export const walkProductionSources = (root: string): string[] => {
  const files: string[] = [];

  const visit = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = resolve(directory, entry);
      const stats = statSync(path);
      if (stats.isDirectory()) {
        if (entry === '__tests__' || entry === 'test-utils') continue;
        visit(path);
        continue;
      }
      if (
        !/\.(ts|tsx)$/.test(entry) ||
        /\.test\.(ts|tsx)$/.test(entry) ||
        entry.endsWith('.d.ts')
      ) {
        continue;
      }
      files.push(path);
    }
  };

  visit(root);
  return files;
};

export const appRelativePath = (path: string): string =>
  relative(APP_ROOT, path).replace(/\\/g, '/');
