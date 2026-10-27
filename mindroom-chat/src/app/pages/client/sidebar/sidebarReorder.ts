import { MatrixClient } from 'matrix-js-sdk';
import { AccountDataEvent } from '../../../../types/matrix/accountData';
import {
  ISidebarFolder,
  SidebarItems,
  TSidebarItem,
  makeCinnySpacesContent,
  parseSidebar,
} from '../../../hooks/useSidebarItems';
import { randomStr } from '../../../utils/common';

export type InstructionType = 'make-child' | 'reorder-above' | 'reorder-below' | 'reparent';

export type FolderDraggable = {
  folder: ISidebarFolder;
  spaceId?: string;
  open?: boolean;
};

export type SidebarDraggable = string | FolderDraggable;

const shouldPersistSidebarReorder = (
  item: SidebarDraggable,
  containerItem: SidebarDraggable,
  instructionType: InstructionType
): boolean =>
  !(
    typeof item === 'string' &&
    typeof containerItem === 'string' &&
    instructionType !== 'make-child'
  );

export type SidebarReorderResult = {
  items: SidebarItems;
  shouldPersistAccountData: boolean;
};

export const reorderSidebarItems = (
  sidebarItems: SidebarItems,
  item: SidebarDraggable,
  containerItem: SidebarDraggable,
  instructionType: InstructionType,
  onEmptyFolder?: (folderId: string) => void
): SidebarReorderResult => {
  const newItems: SidebarItems = [];

  const matchDest = (sI: TSidebarItem, dI: SidebarDraggable): boolean => {
    if (typeof sI === 'string' && typeof dI === 'string') {
      return sI === dI;
    }
    if (typeof sI === 'object' && typeof dI === 'object') {
      return sI.id === dI.folder.id;
    }
    return false;
  };
  const itemAsFolderContent = (i: SidebarDraggable): string[] => {
    if (typeof i === 'string') {
      return [i];
    }
    if (i.spaceId) {
      return [i.spaceId];
    }
    return [...i.folder.content];
  };

  sidebarItems.forEach((i) => {
    const sameFolders =
      typeof item === 'object' &&
      typeof containerItem === 'object' &&
      item.folder.id === containerItem.folder.id;

    // remove draggable space from current position or folder
    if (!sameFolders && matchDest(i, item)) {
      if (typeof item === 'object' && item.spaceId) {
        const folderContent = item.folder.content.filter((s: string) => s !== item.spaceId);
        if (folderContent.length === 0) {
          onEmptyFolder?.(item.folder.id);
          return;
        }
        newItems.push({
          ...item.folder,
          content: folderContent,
        });
      }
      return;
    }
    if (matchDest(i, containerItem)) {
      // we can make child only if
      // container item is space or closed folder
      if (instructionType === 'make-child') {
        const child: string[] = itemAsFolderContent(item);
        if (typeof containerItem === 'string') {
          const folder: ISidebarFolder = {
            id: randomStr(),
            content: [containerItem].concat(child),
          };
          newItems.push(folder);
          return;
        }
        newItems.push({
          ...containerItem.folder,
          content: containerItem.folder.content.concat(child),
        });
        return;
      }

      // drop inside opened folder
      // or reordering inside same folder
      if (typeof containerItem === 'object' && containerItem.spaceId) {
        const child = itemAsFolderContent(item);
        const newContent: string[] = [];
        containerItem.folder.content
          .filter((sId) => !child.includes(sId))
          .forEach((sId: string) => {
            if (sId === containerItem.spaceId) {
              if (instructionType === 'reorder-below') {
                newContent.push(sId, ...child);
              }
              if (instructionType === 'reorder-above') {
                newContent.push(...child, sId);
              }
              return;
            }
            newContent.push(sId);
          });
        const folder = {
          ...containerItem.folder,
          content: newContent,
        };

        newItems.push(folder);
        return;
      }

      // drop above or below space or closed/opened folder
      if (typeof item === 'string') {
        if (instructionType === 'reorder-below') newItems.push(i);
        newItems.push(item);
        if (instructionType === 'reorder-above') newItems.push(i);
      } else if (item.spaceId) {
        if (instructionType === 'reorder-above') {
          newItems.push(item.spaceId);
        }
        if (sameFolders && typeof i === 'object') {
          // remove from folder if placing around itself
          const newI = {
            ...i,
            content: i.content.filter((sId: string) => sId !== item.spaceId),
          };
          if (newI.content.length > 0) newItems.push(newI);
        } else {
          newItems.push(i);
        }
        if (instructionType === 'reorder-below') {
          newItems.push(item.spaceId);
        }
      } else {
        if (instructionType === 'reorder-below') newItems.push(i);
        newItems.push(item.folder);
        if (instructionType === 'reorder-above') newItems.push(i);
      }
      return;
    }
    newItems.push(i);
  });

  return {
    items: newItems,
    shouldPersistAccountData: shouldPersistSidebarReorder(item, containerItem, instructionType),
  };
};

type CommitSidebarReorderOptions = {
  mx: MatrixClient;
  orphanSpaces: string[];
  sidebarItems: SidebarItems;
  accountDataSidebarItems?: SidebarItems;
  item: SidebarDraggable;
  containerItem: SidebarDraggable;
  instructionType: InstructionType;
  onEmptyFolder?: (folderId: string) => void;
  localEchoSidebarItem?: (items: SidebarItems) => void;
  setSpaceOrder: (action: { type: 'REORDER'; order: string[] }) => void;
};

export const commitSidebarReorder = ({
  mx,
  orphanSpaces,
  sidebarItems,
  accountDataSidebarItems = sidebarItems,
  item,
  containerItem,
  instructionType,
  onEmptyFolder,
  localEchoSidebarItem,
  setSpaceOrder,
}: CommitSidebarReorderOptions): SidebarReorderResult => {
  const result = reorderSidebarItems(
    sidebarItems,
    item,
    containerItem,
    instructionType,
    onEmptyFolder
  );

  if (result.shouldPersistAccountData) {
    const accountDataItems =
      accountDataSidebarItems === sidebarItems
        ? result.items
        : reorderSidebarItems(accountDataSidebarItems, item, containerItem, instructionType).items;
    const newSpacesContent = makeCinnySpacesContent(mx, accountDataItems);
    localEchoSidebarItem?.(parseSidebar(mx, orphanSpaces, newSpacesContent));
    void mx.setAccountData(AccountDataEvent.CinnySpaces as any, newSpacesContent as any);
  } else {
    localEchoSidebarItem?.(result.items);
  }

  setSpaceOrder({
    type: 'REORDER',
    order: result.items.filter((newItem): newItem is string => typeof newItem === 'string'),
  });

  return result;
};
