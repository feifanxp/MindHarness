import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  calledIdentifierNames,
  findDependencyCycles,
  memberAccesses,
  moduleDependencies,
  moduleSpecifiers,
  resolvedDependencies,
} from './architectureTestUtils';

const fixtureDirectories: string[] = [];

const createFixtureDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'guards-architecture-'));
  fixtureDirectories.push(directory);
  return directory;
};

const writeFixture = (path: string, source: string): void => writeFileSync(path, source);

afterEach(() => {
  fixtureDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true }));
});

describe('architecture dependency helpers', () => {
  it('classifies every supported dependency form and its explicit type-only status', () => {
    const directory = createFixtureDirectory();
    const source = join(directory, 'source.ts');
    writeFixture(
      source,
      [
        "import './side-effect';",
        "import defaultValue from './default';",
        "import * as values from './namespace';",
        "import value, { type A, B } from './mixed';",
        "import type DefaultType from './type-default';",
        "import type * as Types from './type-namespace';",
        "import { type C, type D } from './type-named';",
        "export { type E, F } from './mixed-export';",
        "export type { G } from './type-export';",
        "export * from './export-all';",
        "void import('./dynamic', { with: { type: 'json' } });",
        "require('./required');",
        "type Imported = import('./import-type').Thing;",
        'void defaultValue; void values; void value;',
      ].join('\n')
    );

    expect(moduleDependencies(source)).toEqual([
      { specifier: './side-effect', kind: 'import', typeOnly: false },
      { specifier: './default', kind: 'import', typeOnly: false },
      { specifier: './namespace', kind: 'import', typeOnly: false },
      { specifier: './mixed', kind: 'import', typeOnly: false },
      { specifier: './type-default', kind: 'import', typeOnly: true },
      { specifier: './type-namespace', kind: 'import', typeOnly: true },
      { specifier: './type-named', kind: 'import', typeOnly: true },
      { specifier: './mixed-export', kind: 'export', typeOnly: false },
      { specifier: './type-export', kind: 'export', typeOnly: true },
      { specifier: './export-all', kind: 'export', typeOnly: false },
      { specifier: './dynamic', kind: 'dynamic-import', typeOnly: false },
      { specifier: './required', kind: 'require', typeOnly: false },
      { specifier: './import-type', kind: 'import-type', typeOnly: true },
    ]);
    expect(moduleSpecifiers(source)).toEqual(
      moduleDependencies(source).map((dependency) => dependency.specifier)
    );
  });

  it('ignores dependency-like text in comments and ordinary strings', () => {
    const directory = createFixtureDirectory();
    const source = join(directory, 'source.ts');
    writeFixture(
      source,
      [
        "// import './comment';",
        "/* export * from './block-comment'; */",
        "const text = \"require('./string') import('./other-string')\";",
        'void text;',
      ].join('\n')
    );

    expect(moduleDependencies(source)).toEqual([]);
  });

  it('resolves explicit type-only dependencies by default and can exclude them', () => {
    const directory = createFixtureDirectory();
    const source = join(directory, 'source.ts');
    const runtime = join(directory, 'runtime.ts');
    const types = join(directory, 'types.ts');
    writeFixture(source, "import './runtime';\nimport type { Value } from './types';");
    writeFixture(runtime, 'export const runtime = true;');
    writeFixture(types, 'export type Value = string;');

    expect(resolvedDependencies(source)).toEqual(new Set([runtime, types]));
    expect(resolvedDependencies(source, { includeTypeOnly: false })).toEqual(new Set([runtime]));
  });

  it('resolves extensionless type-only imports to declaration files', () => {
    const directory = createFixtureDirectory();
    const source = join(directory, 'source.ts');
    const types = join(directory, 'types.d.ts');
    writeFixture(source, "import type { Value } from './types';");
    writeFixture(types, 'export type Value = string;');

    expect(resolvedDependencies(source)).toEqual(new Set([types]));
  });

  it('fails visibly for an unresolved extensionless local TypeScript dependency', () => {
    const directory = createFixtureDirectory();
    const source = join(directory, 'source.ts');
    writeFixture(source, "import './missing';");

    expect(() => resolvedDependencies(source)).toThrow(/Cannot resolve local TypeScript module/);
  });

  it('reports stable concrete runtime cycles and ignores a type-only back edge', () => {
    const directory = createFixtureDirectory();
    const a = join(directory, 'a.ts');
    const b = join(directory, 'b.ts');
    const c = join(directory, 'c.ts');
    writeFixture(a, "import './b';");
    writeFixture(b, "export * from './c';");
    writeFixture(c, 'export const value = true;');
    expect(findDependencyCycles([a, b, c])).toEqual([]);

    writeFixture(c, "void import('./a');");
    expect(findDependencyCycles([a, b, c])[0]).toEqual([a, b, c, a]);

    writeFixture(c, "import type { A } from './a';");
    expect(findDependencyCycles([a, b, c])).toEqual([]);
  });

  it('finds exact dot and bracket member reads, writes, and calls', () => {
    const directory = createFixtureDirectory();
    const source = join(directory, 'source.ts');
    writeFixture(
      source,
      [
        'model.initialEventsFetched = true;',
        "model['replayEvents'] = null;",
        'model.initialEventsFetched;',
        'model.fetchRelations;',
        "model['fetchRelations']();",
        'const text = "model[\'ignored\']";',
        'void text;',
      ].join('\n')
    );

    expect(memberAccesses(source)).toEqual([
      { name: 'initialEventsFetched', kind: 'write' },
      { name: 'replayEvents', kind: 'write' },
      { name: 'initialEventsFetched', kind: 'read' },
      { name: 'fetchRelations', kind: 'read' },
      { name: 'fetchRelations', kind: 'call' },
    ]);
  });

  it('finds direct identifier calls without counting declarations, reads, text, or member calls', () => {
    const directory = createFixtureDirectory();
    const source = join(directory, 'source.ts');
    writeFixture(
      source,
      [
        'function fetchThreadBootstrapRelations() {}',
        'const read = fetchThreadBootstrapRelations;',
        'const text = "fetchThreadBootstrapRelations()";',
        '// fetchThreadBootstrapRelations();',
        'fetchThreadBootstrapRelations();',
        'object.fetchThreadBootstrapRelations();',
        'void read; void text;',
      ].join('\n')
    );

    expect(calledIdentifierNames(source)).toEqual(['fetchThreadBootstrapRelations']);
  });
});
