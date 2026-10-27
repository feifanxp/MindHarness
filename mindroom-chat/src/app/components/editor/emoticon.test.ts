import type { Descendant } from 'slate';
import { expect, it } from 'vitest';
import { toMatrixCustomHTML } from './output';
import { createEmoticonElement } from './utils';

it('escapes the emoticon source url in custom html', () => {
  const key = 'mxc://example.org/a" /><a href="https://example.org">link</a><img src="mxc://x/y';
  const nodes = [createEmoticonElement(key, 'smile')] as Descendant[];

  expect(toMatrixCustomHTML(nodes, {})).toBe(
    '<img data-mx-emoticon src="mxc://example.org/a&quot; /&gt;&lt;a href=&quot;https://example.org&quot;&gt;link&lt;/a&gt;&lt;img src=&quot;mxc://x/y" alt="smile" title="smile" height="32" />'
  );
});
