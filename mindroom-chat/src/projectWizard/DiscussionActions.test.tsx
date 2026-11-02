// @vitest-environment jsdom
import React, { type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { DiscussionActions, type DiscussionSummary } from './DiscussionActions';
import { wizardRequest, type WizardState } from './api';

vi.mock('./api', () => ({ wizardRequest: vi.fn() }));
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('folds', async (original) => ({
  ...(await original<typeof import('folds')>()),
  PopOut: ({ anchor, content }: { anchor: unknown; content: ReactNode }) =>
    anchor ? content : null,
}));
vi.mock('../app/components/glass/GlassPrimitives', () => ({
  Menu: ({ children, ...props }: React.ComponentProps<'div'>) => <div {...props}>{children}</div>,
  MenuItem: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  Surface: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
let renderer: ReactTestRenderer;
const changed = vi.fn();
const dialog = { open: false, showModal: vi.fn(), close: vi.fn() };
const item: DiscussionSummary = {
  draft_id: 'draft-1',
  name: '测试讨论',
  revision: 4,
  status: 'created',
  updated_at: 1,
};
const button = (label: string) =>
  renderer.root
    .findAllByType('button')
    .find(
      (node) =>
        node.children.join('') === label ||
        node.findAllByType('span').some((span) => span.children.join('') === label)
    )!;
async function mount(archived = false) {
  await act(async () => {
    renderer = create(<DiscussionActions item={{ ...item, archived }} onChanged={changed} />, {
      createNodeMock: (element) => (element.type === 'dialog' ? dialog : { focus: vi.fn() }),
    });
  });
  act(() =>
    renderer.root.findByProps({ 'aria-haspopup': 'menu' }).props.onClick({
      currentTarget: {
        getBoundingClientRect: () => ({
          top: 0,
          left: 0,
          right: 32,
          bottom: 32,
          height: 32,
          width: 32,
        }),
      },
    })
  );
}
afterEach(() => {
  act(() => renderer?.unmount());
  vi.clearAllMocks();
});

it('opens rename and sends the reviewed revision with the trimmed title', async () => {
  await mount();
  act(() => button('重命名').props.onClick());
  expect(dialog.showModal).toHaveBeenCalled();
  act(() => renderer.root.findByType('input').props.onChange({ target: { value: ' 新标题 ' } }));
  const updated = { draft_id: item.draft_id, revision: 5 } as WizardState;
  vi.mocked(wizardRequest).mockResolvedValue(updated);
  await act(async () =>
    renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() })
  );
  expect(wizardRequest).toHaveBeenCalledWith('/drafts/draft-1', 'PATCH', {
    revision: 4,
    name: '新标题',
  });
  expect(changed).toHaveBeenCalledWith('draft-1', 'rename', updated);
});

it.each([false, true])(
  'archives or restores without deleting content (archived=%s)',
  async (archived) => {
    await mount(archived);
    vi.mocked(wizardRequest).mockResolvedValue({
      ...item,
      archived: !archived,
    } as unknown as WizardState);
    await act(async () => button(archived ? '取消归档' : '归档').props.onClick());
    expect(wizardRequest).toHaveBeenCalledWith('/drafts/draft-1/archive', 'PATCH', {
      revision: 4,
      archived: !archived,
    });
  }
);

it('requires confirmation before deleting and allows cancellation', async () => {
  await mount();
  act(() => button('删除').props.onClick());
  expect(wizardRequest).not.toHaveBeenCalled();
  expect(renderer.root.findByType('p').children.join('')).toContain('Matrix 聊天记录保留');
  act(() => button('取消').props.onClick());
  expect(wizardRequest).not.toHaveBeenCalled();
});

it('deletes only the selected discussion after confirmation', async () => {
  await mount();
  act(() => button('删除').props.onClick());
  vi.mocked(wizardRequest).mockResolvedValue(null);
  await act(async () =>
    renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() })
  );
  expect(wizardRequest).toHaveBeenCalledWith('/drafts/draft-1', 'DELETE', { revision: 4 });
  expect(changed).toHaveBeenCalledWith('draft-1', 'delete', null);
});

it('keeps a failed operation visible without removing the discussion', async () => {
  await mount();
  act(() => button('删除').props.onClick());
  vi.mocked(wizardRequest).mockRejectedValue(new Error('方案已更新，请重新加载'));
  await act(async () =>
    renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() })
  );
  expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('重新加载');
  expect(changed).not.toHaveBeenCalled();
});
