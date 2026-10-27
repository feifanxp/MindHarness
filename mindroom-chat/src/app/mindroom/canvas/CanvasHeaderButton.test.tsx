import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { Scroll, Text } from 'folds';
import { describe, expect, it, vi } from 'vitest';
import { CanvasHeaderButton } from './CanvasHeaderButton';
import type { CanvasListEntry } from './canvasIndexStore';

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('folds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('folds')>()),
  PopOut: ({ anchor, content }: { anchor?: unknown; content: React.ReactNode }) =>
    anchor ? content : null,
  TooltipProvider: ({
    tooltip,
    children,
  }: {
    tooltip: React.ReactNode;
    children: (ref: () => void) => React.ReactNode;
  }) => (
    <>
      {tooltip}
      {children(() => undefined)}
    </>
  ),
}));

const canvas = (id: string, title: string, updatedTs: number): CanvasListEntry => ({
  canvasId: id,
  roomId: '!room:mindroom.test',
  threadId: '$thread',
  agentUserId: '@mindroom_planner:mindroom.test',
  title,
  createdTs: 1,
  revisionId: id,
  updatedTs,
  shared: false,
});

const budget = canvas('$c1', 'Budget', 3_000);
const roadmap = canvas('$c2', 'Roadmap', 2_000);
const survey = canvas('$c3', 'Survey', 1_000);

const anchorEvent = {
  currentTarget: { getBoundingClientRect: () => ({ x: 0, y: 0, width: 32, height: 32 }) },
};

type Props = React.ComponentProps<typeof CanvasHeaderButton>;

const render = (props: Partial<Props> = {}) => {
  const handlers = { onOpen: vi.fn(), onClose: vi.fn() };
  const all: Props = { canvases: [budget], ...handlers, ...props };
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<CanvasHeaderButton {...all} />);
  });
  return {
    renderer,
    ...handlers,
    update: (next: Partial<Props>) =>
      act(() => renderer.update(<CanvasHeaderButton {...all} {...next} />)),
  };
};

const trigger = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => node.type === 'button' && node.props['aria-label'])[0];

const menuItems = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => node.type === 'button' && !node.props['aria-label']);

const nodeText = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : nodeText(child))).join('');

/** The menu's titles in order: each item's first text is the title, the second its update time. */
const titles = (renderer: ReactTestRenderer) =>
  menuItems(renderer).map((item) => nodeText(item.findAllByType(Text)[0]));

const openMenu = (renderer: ReactTestRenderer) =>
  act(() => trigger(renderer).props.onClick(anchorEvent));

describe('CanvasHeaderButton', () => {
  it('renders nothing without canvases', () => {
    expect(render({ canvases: [] }).renderer.toJSON()).toBeNull();
  });

  it('toggles a single canvas', () => {
    const { renderer, onOpen, onClose, update } = render({ canvases: [budget] });

    expect(trigger(renderer).props['aria-label']).toBe('Show Canvas');
    expect(trigger(renderer).props['aria-pressed']).toBe(false);
    act(() => trigger(renderer).props.onClick(anchorEvent));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith('$c1');
    expect(onClose).not.toHaveBeenCalled();
    expect(menuItems(renderer)).toHaveLength(0);

    update({ openCanvasId: '$c1' });
    expect(trigger(renderer).props['aria-label']).toBe('Hide Canvas');
    expect(trigger(renderer).props['aria-pressed']).toBe(true);
    act(() => trigger(renderer).props.onClick(anchorEvent));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('lists several canvases in the given order and marks the open one', () => {
    const { renderer } = render({ canvases: [budget, roadmap, survey], openCanvasId: '$c2' });

    expect(trigger(renderer).props['aria-label']).toBe('Canvases');
    expect(trigger(renderer).props['aria-pressed']).toBe(true);
    expect(menuItems(renderer)).toHaveLength(0);

    openMenu(renderer);
    const items = menuItems(renderer);
    expect(items).toHaveLength(3);
    expect(titles(renderer)).toEqual(['Budget', 'Roadmap', 'Survey']);
    expect(items.map((item) => item.props['aria-current'])).toEqual([undefined, 'true', undefined]);
    // The update time is there for telling same-named canvases apart.
    const time = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });
    expect(nodeText(items[0])).toBe(`Budget${time.format(3_000)}`);
  });

  it('keeps a long menu inside the viewport and scrolls its choices', () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      canvas(`$many${index}`, `Canvas ${index}`, 30_000 - index)
    );
    const { renderer } = render({ canvases: many });
    openMenu(renderer);

    // The choices sit in a scroll area, below the title, inside a menu with a viewport-bound height.
    const scroll = renderer.root.findByType(Scroll);
    expect(scroll.findAll((node) => menuItems(renderer).includes(node))).toHaveLength(30);
    let bounded: ReactTestInstance | null = scroll.parent;
    while (bounded && !bounded.props.style?.maxHeight) bounded = bounded.parent;
    expect(bounded?.props.style).toMatchObject({
      display: 'flex',
      flexDirection: 'column',
      maxHeight: expect.stringContaining('100vh'),
      maxWidth: expect.anything(),
    });
  });

  it('opens the chosen canvas and closes the menu', () => {
    const { renderer, onOpen, onClose } = render({
      canvases: [budget, roadmap],
      openCanvasId: '$c1',
    });

    openMenu(renderer);
    act(() => menuItems(renderer)[1].props.onClick());

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith('$c2');
    expect(onClose).not.toHaveBeenCalled();
    expect(menuItems(renderer)).toHaveLength(0);
  });

  it('closes the open canvas when it is chosen again', () => {
    const { renderer, onOpen, onClose } = render({
      canvases: [budget, roadmap],
      openCanvasId: '$c1',
    });

    openMenu(renderer);
    act(() => menuItems(renderer)[0].props.onClick());

    expect(onClose).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
    expect(menuItems(renderer)).toHaveLength(0);
  });

  it('keeps the menu and the open mark while an update reorders the list', () => {
    const { renderer, update } = render({
      canvases: [budget, roadmap, survey],
      openCanvasId: '$c2',
    });
    openMenu(renderer);

    update({ canvases: [{ ...survey, updatedTs: 9_000, title: 'Survey v2' }, budget, roadmap] });

    const items = menuItems(renderer);
    expect(titles(renderer)).toEqual(['Survey v2', 'Budget', 'Roadmap']);
    expect(items.map((item) => item.props['aria-current'])).toEqual([undefined, undefined, 'true']);
  });

  it('closes the menu when only one canvas is left, and does not bring it back later', () => {
    const { renderer, update } = render({ canvases: [budget, roadmap] });
    openMenu(renderer);

    update({ canvases: [budget] });
    expect(menuItems(renderer)).toHaveLength(0);
    update({ canvases: [budget, roadmap] });
    expect(menuItems(renderer)).toHaveLength(0);
  });

  it('is not pressed while the open canvas is not one of this conversation’s', () => {
    const { renderer } = render({ canvases: [budget, roadmap], openCanvasId: '$elsewhere' });

    expect(trigger(renderer).props['aria-pressed']).toBe(false);
  });
});
