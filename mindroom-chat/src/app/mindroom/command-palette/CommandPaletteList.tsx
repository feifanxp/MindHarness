import { Icon, Icons, type IconSrc } from 'folds';
import React, { useEffect, useRef } from 'react';
import { UnreadBadge } from '../../components/unread-badge';
import type { CommandPaletteItem, CommandPaletteSectionId } from './commandPaletteTypes';
import * as css from './CommandPalette.css';

export type CommandPaletteListSection = {
  id: CommandPaletteSectionId;
  title: string;
  items: CommandPaletteItem[];
};

type CommandPaletteListProps = {
  id: string;
  label: string;
  sections: readonly CommandPaletteListSection[];
  selectedItemId?: string;
  onSelect: (item: CommandPaletteItem) => void;
  onHighlight: (itemId: string) => void;
};

export const getCommandPaletteOptionId = (listId: string, itemId: string): string =>
  listId + '-' + encodeURIComponent(itemId);

const getItemTitle = (item: CommandPaletteItem): string => {
  switch (item.kind) {
    case 'action':
      return item.title;
    case 'room':
    case 'space':
      return item.name;
    case 'user':
      return item.displayName;
    case 'thread':
      return item.summaryText;
    default:
      return item.title;
  }
};

const getItemDescription = (item: CommandPaletteItem): string | undefined => {
  switch (item.kind) {
    case 'action':
      return item.description;
    case 'room':
    case 'space':
      return item.topic ?? item.canonicalAlias;
    case 'user':
      return item.userId;
    case 'thread':
      return item.roomName;
    default:
      return item.description;
  }
};

const getItemIcon = (item: CommandPaletteItem): IconSrc | undefined => {
  switch (item.kind) {
    case 'action':
      return Icons.Terminal;
    case 'thread':
      return Icons.Message;
    case 'room':
      return Icons.Hash;
    case 'space':
      return Icons.Space;
    case 'user':
      return Icons.User;
    case 'message':
      return Icons.Search;
    default:
      return undefined;
  }
};

export function CommandPaletteList({
  id,
  label,
  sections,
  selectedItemId,
  onSelect,
  onHighlight,
}: CommandPaletteListProps) {
  const selectedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedItemId]);

  return (
    <div id={id} role="listbox" aria-label={label}>
      {sections.map((section) => (
        <div
          key={section.id}
          className={css.Group}
          role="group"
          aria-labelledby={id + '-' + section.id}
        >
          <div id={id + '-' + section.id} className={css.GroupTitle} role="presentation">
            {section.title}
            <span className={css.GroupCount} aria-hidden="true">
              {section.items.length}
            </span>
          </div>
          {section.items.map((item) => {
            const description = getItemDescription(item);
            const icon = getItemIcon(item);
            const isSelected = selectedItemId === item.id;
            return (
              // Keyboard activation belongs to the combobox, which retains DOM focus.
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events
              <div
                key={item.id}
                id={getCommandPaletteOptionId(id, item.id)}
                ref={isSelected ? selectedRef : undefined}
                role="option"
                aria-selected={isSelected}
                tabIndex={-1}
                className={css.Row}
                data-item-id={item.id}
                data-kind={item.kind}
                data-selected={isSelected}
                onPointerMove={(event) => {
                  if (event.pointerType === 'mouse' && !isSelected) onHighlight(item.id);
                }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(item)}
              >
                {icon && (
                  <span className={css.RowIcon} aria-hidden="true">
                    <Icon size="200" src={icon} />
                  </span>
                )}
                <span className={css.RowText}>
                  <span className={css.RowTitle}>{getItemTitle(item)}</span>
                  {description && <span className={css.RowDescription}>{description}</span>}
                </span>
                {(item.kind === 'room' || item.kind === 'space') &&
                  item.unreadCount !== undefined && (
                    <UnreadBadge highlight={!!item.unreadHighlight} count={item.unreadCount} />
                  )}
                <span className={css.RowEnter} aria-hidden="true">
                  ↵
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
