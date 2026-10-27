import { describe, expect, it, vi } from 'vitest';
import { MatrixClient } from 'matrix-js-sdk';
import { AccountDataEvent } from '../../../../types/matrix/accountData';
import { commitSidebarReorder } from './sidebarReorder';

const makeMatrixClient = (sidebar: unknown): MatrixClient =>
  ({
    getAccountData: vi.fn(() => ({
      getContent: () => ({
        existing: true,
        sidebar,
      }),
    })),
    setAccountData: vi.fn(),
  } as unknown as MatrixClient);

describe('SpaceTabs sidebar reorder persistence', () => {
  it('keeps plain top-level space reorder local without writing m.cinny.spaces account-data', () => {
    const mx = makeMatrixClient(['!space-a:example.org', '!space-b:example.org']);
    const setSpaceOrder = vi.fn();

    const result = commitSidebarReorder({
      mx,
      orphanSpaces: [],
      sidebarItems: ['!space-a:example.org', '!space-b:example.org'],
      item: '!space-a:example.org',
      containerItem: '!space-b:example.org',
      instructionType: 'reorder-below',
      setSpaceOrder,
    });

    expect(result.items).toEqual(['!space-b:example.org', '!space-a:example.org']);
    expect(result.shouldPersistAccountData).toBe(false);
    expect(mx.setAccountData).not.toHaveBeenCalled();
    expect(setSpaceOrder).toHaveBeenCalledWith({
      type: 'REORDER',
      order: ['!space-b:example.org', '!space-a:example.org'],
    });
  });

  it('writes m.cinny.spaces account-data for top-level folder reorders', () => {
    const folder = {
      id: 'folder-1',
      content: ['!space-a:example.org'],
    };
    const mx = makeMatrixClient([folder, '!space-b:example.org']);

    const result = commitSidebarReorder({
      mx,
      orphanSpaces: [],
      sidebarItems: [folder, '!space-b:example.org'],
      item: { folder },
      containerItem: '!space-b:example.org',
      instructionType: 'reorder-below',
      setSpaceOrder: vi.fn(),
    });

    expect(result.items).toEqual(['!space-b:example.org', folder]);
    expect(result.shouldPersistAccountData).toBe(true);
    expect(mx.setAccountData).toHaveBeenCalledWith(AccountDataEvent.CinnySpaces, {
      existing: true,
      sidebar: ['!space-b:example.org', folder],
    });
  });

  it('writes m.cinny.spaces account-data for in-folder content reorders', () => {
    const folder = {
      id: 'folder-1',
      content: ['!space-a:example.org', '!space-b:example.org'],
    };
    const mx = makeMatrixClient([folder, '!space-c:example.org']);

    const result = commitSidebarReorder({
      mx,
      orphanSpaces: [],
      sidebarItems: [folder, '!space-c:example.org'],
      item: { folder, spaceId: '!space-a:example.org' },
      containerItem: { folder, spaceId: '!space-b:example.org' },
      instructionType: 'reorder-below',
      setSpaceOrder: vi.fn(),
    });

    expect(result.items).toEqual([
      {
        id: 'folder-1',
        content: ['!space-b:example.org', '!space-a:example.org'],
      },
      '!space-c:example.org',
    ]);
    expect(result.shouldPersistAccountData).toBe(true);
    expect(mx.setAccountData).toHaveBeenCalledWith(AccountDataEvent.CinnySpaces, {
      existing: true,
      sidebar: [
        {
          id: 'folder-1',
          content: ['!space-b:example.org', '!space-a:example.org'],
        },
        '!space-c:example.org',
      ],
    });
  });

  it('writes m.cinny.spaces account-data for folder-shape mutations', () => {
    const folder = {
      id: 'folder-1',
      content: ['!space-a:example.org'],
    };
    const mx = makeMatrixClient([folder, '!space-b:example.org']);
    const setSpaceOrder = vi.fn();
    const onEmptyFolder = vi.fn();

    const result = commitSidebarReorder({
      mx,
      orphanSpaces: [],
      sidebarItems: [folder, '!space-b:example.org'],
      item: { folder, spaceId: '!space-a:example.org' },
      containerItem: '!space-b:example.org',
      instructionType: 'reorder-below',
      onEmptyFolder,
      setSpaceOrder,
    });

    expect(result.items).toEqual(['!space-b:example.org', '!space-a:example.org']);
    expect(result.shouldPersistAccountData).toBe(true);
    expect(onEmptyFolder).toHaveBeenCalledWith('folder-1');
    expect(mx.setAccountData).toHaveBeenCalledWith(AccountDataEvent.CinnySpaces, {
      existing: true,
      sidebar: ['!space-b:example.org', '!space-a:example.org'],
    });
  });

  it('keeps prior local-only top-level order out of the next folder-shape account-data write', () => {
    const folder = {
      id: 'folder-1',
      content: ['!space-c:example.org'],
    };
    const mx = makeMatrixClient(['!space-a:example.org', '!space-b:example.org', folder]);

    commitSidebarReorder({
      mx,
      orphanSpaces: [],
      sidebarItems: ['!space-b:example.org', '!space-a:example.org', folder],
      accountDataSidebarItems: ['!space-a:example.org', '!space-b:example.org', folder],
      item: { folder, spaceId: '!space-c:example.org' },
      containerItem: '!space-b:example.org',
      instructionType: 'reorder-below',
      setSpaceOrder: vi.fn(),
    });

    expect(mx.setAccountData).toHaveBeenCalledWith(AccountDataEvent.CinnySpaces, {
      existing: true,
      sidebar: ['!space-a:example.org', '!space-b:example.org', '!space-c:example.org'],
    });
  });

  it('keeps prior local-only top-level order out of plain-space into-folder writes', () => {
    const folder = {
      id: 'folder-1',
      content: ['!space-c:example.org'],
    };
    const mx = makeMatrixClient(['!space-a:example.org', '!space-b:example.org', folder]);

    commitSidebarReorder({
      mx,
      orphanSpaces: [],
      sidebarItems: ['!space-b:example.org', '!space-a:example.org', folder],
      accountDataSidebarItems: ['!space-a:example.org', '!space-b:example.org', folder],
      item: '!space-b:example.org',
      containerItem: { folder },
      instructionType: 'make-child',
      setSpaceOrder: vi.fn(),
    });

    expect(mx.setAccountData).toHaveBeenCalledWith(AccountDataEvent.CinnySpaces, {
      existing: true,
      sidebar: [
        '!space-a:example.org',
        {
          id: 'folder-1',
          content: ['!space-c:example.org', '!space-b:example.org'],
        },
      ],
    });
  });
});
