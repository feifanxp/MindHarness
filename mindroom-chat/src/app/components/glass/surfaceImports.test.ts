import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: fileURLToPath(new URL('../../../../', import.meta.url)) });
const consumerPath = 'src/app/components/glass/SurfaceConsumer.tsx';
const adapterPath = 'src/app/components/glass/GlassPrimitives.tsx';

async function lint(source: string, filePath = consumerPath) {
  const [result] = await eslint.lintText(source, { filePath });
  expect(result.fatalErrorCount).toBe(0);
  return result;
}

describe('shared surface import boundary', () => {
  it.each([
    "import { Menu } from 'folds';\n\nexport { Menu };",
    "import { MenuItem } from 'folds';\n\nexport { MenuItem };",
    "import { Modal } from 'folds';\n\nexport { Modal };",
    "import { Dialog } from 'folds';\n\nexport { Dialog };",
    "import { Header } from 'folds';\n\nexport { Header };",
    "import { Menu as RawMenu } from 'folds';\n\nexport { RawMenu };",
    "export { Dialog } from 'folds';",
    "export { Header as RawHeader } from 'folds';",
    "import * as Folds from 'folds';\n\nexport { Folds };",
    "import Folds from 'folds';\n\nexport { Folds };",
    "import { default as Folds } from 'folds';\n\nexport { Folds };",
    "export { default } from 'folds';",
    "export { default as Folds } from 'folds';",
    "export * from 'folds';",
    "export * as Folds from 'folds';",
    "import { Menu } from 'folds/dist/index.js';\n\nexport { Menu };",
    "export { Dialog } from 'folds/dist/index.js';",
    "import * as Folds from 'folds/dist/index.js';\n\nexport { Folds };",
    "export * from 'folds/dist/index.js';",
    "export { Menu } from 'folds/dist/index';",
    "export { Menu } from 'folds/dist';",
    "export { Menu } from 'folds/dist/components/menu/Menu';",
    "export { Menu } from 'folds/dist/components/menu/Menu.js';",
    "export { Menu } from 'folds/src/components/menu/Menu';",
    "export { Menu } from 'folds/dist/style.css.js';",
  ])('rejects a raw surface bypass: %s', async (source) => {
    const result = await lint(source);
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'no-restricted-imports',
          severity: 2,
          message: expect.stringContaining('components/glass/GlassPrimitives'),
        }),
      ])
    );
  });

  it.each([
    "import { Box, Icon } from 'folds';\n\nexport { Box, Icon };",
    "import { Box as Menu } from 'folds';\n\nexport { Menu };",
    "export { Box, Icon } from 'folds';",
    "import type { ContainerColor, ModalProps } from 'folds';\n\nexport type { ContainerColor, ModalProps };",
    "import 'folds/dist/style.css';",
    "import { Menu, Header } from './GlassPrimitives';\n\nexport { Menu, Header };",
  ])('allows supported imports: %s', async (source) => {
    const result = await lint(source);
    expect(result.messages).toEqual([]);
  });

  it('allows raw primitives only in the adapter implementation', async () => {
    const result = await lint(
      "import { Menu, MenuItem, Modal, Dialog, Header } from 'folds';\n\nexport { Menu, MenuItem, Modal, Dialog, Header };",
      adapterPath
    );
    expect(result.messages).toEqual([]);
  });

  it.each([
    'src/app/components/glass/GlassPrimitives.test.tsx',
    'src/app/components/glass/SurfaceConsumer.test.ts',
    'src/app/components/glass/nested/GlassPrimitives.tsx',
    'src/app/components/other/GlassPrimitives.tsx',
    'src/app/components/nav/NavCategoryHeader.tsx',
    'src/app/SurfaceConsumer.js',
    'src/app/SurfaceConsumer.jsx',
  ])('keeps the adapter exception narrow: %s', async (filePath) => {
    const result = await lint("export { Header } from 'folds';", filePath);
    expect(result.messages).toEqual([
      expect.objectContaining({ ruleId: 'no-restricted-imports', severity: 2 }),
    ]);
  });
});
