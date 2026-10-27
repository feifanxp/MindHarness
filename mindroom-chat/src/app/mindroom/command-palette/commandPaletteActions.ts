import { type TFunction } from 'i18next';
import {
  getDirectCreatePath,
  getDirectPath,
  getHomePath,
  getHomeSearchPath,
  getInboxPath,
  getSpaceSearchPath,
} from '../../pages/pathUtils';
import type { CommandPaletteActionItem, CommandPaletteMessageItem } from './commandPaletteTypes';

export type CommandPaletteQuickActionId =
  | 'open-settings'
  | 'go-home'
  | 'go-direct'
  | 'go-inbox'
  | 'create-room'
  | 'create-space'
  | 'mark-current-room-read'
  | 'copy-current-room-link'
  | 'open-current-room-settings'
  | 'resolve-current-thread'
  | 'unresolve-current-thread'
  | 'toggle-theme'
  | 'logout';

export type CommandPaletteQuickActionContext = {
  currentRoomName?: string;
  currentThreadId?: string;
  isCurrentThreadResolved?: boolean;
  isCurrentThreadPinned?: boolean;
};

export type CommandPaletteUserTarget =
  | {
      kind: 'room';
      roomId: string;
    }
  | {
      kind: 'path';
      path: string;
    };

export type CommandPaletteMessageTarget = CommandPaletteMessageItem & {
  path: string;
};

const buildPathWithSearch = (
  path: string,
  searchParams: Record<string, string | undefined>
): string => {
  const params = new URLSearchParams();

  Object.entries(searchParams).forEach(([key, value]) => {
    if (typeof value === 'string' && value.length > 0) {
      params.set(key, value);
    }
  });

  const search = params.toString();
  return search.length > 0 ? `${path}?${search}` : path;
};

const quoteQuery = (query: string): string => `"${query}"`;

const actionItem = (
  id: CommandPaletteQuickActionId,
  title: string,
  sortRank: number,
  options?: Pick<CommandPaletteActionItem, 'description' | 'keywords'>
): CommandPaletteActionItem => ({
  id,
  kind: 'action',
  title,
  sortRank,
  ...options,
});

export const getCommandPaletteQuickActions = (
  {
    currentRoomName,
    currentThreadId,
    isCurrentThreadResolved,
    isCurrentThreadPinned,
  }: CommandPaletteQuickActionContext,
  t: TFunction
): CommandPaletteActionItem[] => {
  const roomLabel = currentRoomName ?? t('commandPalette.actions.currentRoomFallback');
  const actions: CommandPaletteActionItem[] = [
    actionItem('open-settings', t('commandPalette.actions.openSettings'), 130, {
      description: t('commandPalette.actions.openSettingsDescription'),
      keywords: ['preferences'],
    }),
    actionItem('go-home', t('commandPalette.actions.goHome'), 120, {
      description: t('commandPalette.actions.goHomeDescription'),
      keywords: ['rooms'],
    }),
    actionItem('go-direct', t('commandPalette.actions.goDirect'), 110, {
      description: t('commandPalette.actions.goDirectDescription'),
      keywords: ['dm', 'messages'],
    }),
    actionItem('go-inbox', t('commandPalette.actions.goInbox'), 100, {
      description: t('commandPalette.actions.goInboxDescription'),
      keywords: ['notifications'],
    }),
    actionItem('create-room', t('commandPalette.actions.createRoom'), 90, {
      description: t('commandPalette.actions.createRoomDescription'),
      keywords: ['new room'],
    }),
    actionItem('create-space', t('commandPalette.actions.createSpace'), 80, {
      description: t('commandPalette.actions.createSpaceDescription'),
      keywords: ['new space'],
    }),
    actionItem('toggle-theme', t('commandPalette.actions.toggleTheme'), 20, {
      description: t('commandPalette.actions.toggleThemeDescription'),
      keywords: ['appearance'],
    }),
    actionItem('logout', t('commandPalette.actions.logout'), 10, {
      description: t('commandPalette.actions.logoutDescription'),
      keywords: ['sign out'],
    }),
  ];

  if (currentRoomName) {
    actions.splice(
      6,
      0,
      actionItem('mark-current-room-read', t('commandPalette.actions.markCurrentRoomRead'), 70, {
        description: t('commandPalette.actions.markCurrentRoomReadDescription', {
          room: roomLabel,
        }),
        keywords: ['read', 'unread'],
      }),
      actionItem('copy-current-room-link', t('commandPalette.actions.copyCurrentRoomLink'), 60, {
        description: t('commandPalette.actions.copyCurrentRoomLinkDescription', {
          room: roomLabel,
        }),
        keywords: ['share', 'link'],
      }),
      actionItem(
        'open-current-room-settings',
        t('commandPalette.actions.openCurrentRoomSettings'),
        50,
        {
          description: t('commandPalette.actions.openCurrentRoomSettingsDescription', {
            room: roomLabel,
          }),
          keywords: ['room settings'],
        }
      )
    );
  }

  if (currentThreadId && !isCurrentThreadPinned) {
    actions.splice(
      actions.findIndex((item) => item.id === 'toggle-theme'),
      0,
      isCurrentThreadResolved
        ? actionItem(
            'unresolve-current-thread',
            t('commandPalette.actions.unresolveCurrentThread'),
            40,
            {
              description: t('commandPalette.actions.unresolveCurrentThreadDescription'),
              keywords: ['thread', 'reopen'],
            }
          )
        : actionItem(
            'resolve-current-thread',
            t('commandPalette.actions.resolveCurrentThread'),
            40,
            {
              description: t('commandPalette.actions.resolveCurrentThreadDescription'),
              keywords: ['thread', 'done'],
            }
          )
    );
  }

  return actions;
};

export type CommandPaletteMessageContext = {
  query: string;
  currentRoomId?: string;
  currentRoomName?: string;
  currentSpaceId?: string;
  currentSpaceName?: string;
};

export const getCommandPaletteMessageTargets = (
  {
    query,
    currentRoomId,
    currentRoomName,
    currentSpaceId,
    currentSpaceName,
  }: CommandPaletteMessageContext,
  t: TFunction
): CommandPaletteMessageTarget[] => {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) return [];

  const items: CommandPaletteMessageTarget[] = [];
  const quotedQuery = quoteQuery(trimmedQuery);

  if (currentRoomId) {
    items.push({
      id: `message-room-${currentRoomId}-${trimmedQuery}`,
      kind: 'message',
      title: t('commandPalette.messages.searchIn', {
        query: quotedQuery,
        scope: currentRoomName ?? t('commandPalette.messages.currentRoomFallback'),
      }),
      description: currentRoomName ?? t('commandPalette.messages.currentRoomDescription'),
      scope: 'room',
      path: buildPathWithSearch(
        currentSpaceId ? getSpaceSearchPath(currentSpaceId) : getHomeSearchPath(),
        {
          term: trimmedQuery,
          rooms: currentRoomId,
        }
      ),
    });
  }

  if (currentSpaceId) {
    items.push({
      id: `message-space-${currentSpaceId}-${trimmedQuery}`,
      kind: 'message',
      title: t('commandPalette.messages.searchIn', {
        query: quotedQuery,
        scope: currentSpaceName ?? t('commandPalette.messages.currentSpaceFallback'),
      }),
      description: currentSpaceName ?? t('commandPalette.messages.currentSpaceDescription'),
      scope: 'space',
      path: buildPathWithSearch(getSpaceSearchPath(currentSpaceId), {
        term: trimmedQuery,
      }),
    });
  }

  items.push({
    id: `message-all-${trimmedQuery}`,
    kind: 'message',
    title: t('commandPalette.messages.searchAll', { query: quotedQuery }),
    description: t('commandPalette.messages.globalSearchDescription'),
    scope: 'all',
    path: buildPathWithSearch(getHomeSearchPath(), {
      term: trimmedQuery,
      global: 'true',
    }),
  });

  return items;
};

export const resolveCommandPaletteUserTarget = (
  userId: string,
  existingDmRoomId?: string
): CommandPaletteUserTarget => {
  if (existingDmRoomId) {
    return {
      kind: 'room',
      roomId: existingDmRoomId,
    };
  }

  return {
    kind: 'path',
    path: buildPathWithSearch(getDirectCreatePath(), {
      userId,
    }),
  };
};

export const commandPaletteStaticActionPaths = {
  goHome: getHomePath(),
  goDirect: getDirectPath(),
  goInbox: getInboxPath(),
} as const;
