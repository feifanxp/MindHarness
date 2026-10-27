export const COMMAND_PALETTE_PREFIX_HINTS = ['#', 't:', '@', '>', '*'] as const;

export type CommandPalettePrefix = typeof COMMAND_PALETTE_PREFIX_HINTS[number];

export type CommandPaletteMode = 'all' | 'actions' | 'rooms' | 'spaces' | 'users' | 'threads';

export type CommandPaletteSectionId = 'actions' | 'threads' | 'rooms' | 'users' | 'messages';

export type CommandPaletteParsedQuery = {
  raw: string;
  prefix?: CommandPalettePrefix;
  mode: CommandPaletteMode;
  searchText: string;
  showMessages: boolean;
};

type CommandPaletteBaseItem = {
  id: string;
  boost?: number;
  sortRank?: number;
};

export type CommandPaletteActionItem = CommandPaletteBaseItem & {
  kind: 'action';
  title: string;
  description?: string;
  keywords?: string[];
};

export type CommandPaletteRoomItem = CommandPaletteBaseItem & {
  kind: 'room' | 'space';
  name: string;
  canonicalAlias?: string;
  topic?: string;
  parentNames?: string[];
  unreadCount?: number;
  unreadHighlight?: boolean;
};

export type CommandPaletteUserItem = CommandPaletteBaseItem & {
  kind: 'user';
  displayName: string;
  userId: string;
  localpart: string;
  dmRoomName?: string;
  existingDmRoomId?: string;
};

export type CommandPaletteThreadItem = CommandPaletteBaseItem & {
  kind: 'thread';
  roomId: string;
  threadId: string;
  summaryText: string;
  isFallbackSummary?: boolean;
  roomName: string;
  participantNames?: string[];
  tags?: string[];
  isResolved?: boolean;
  messageCount?: number;
};

export type CommandPaletteMessageItem = CommandPaletteBaseItem & {
  kind: 'message';
  title: string;
  description?: string;
  scope: 'room' | 'space' | 'all';
};

export type CommandPaletteItem =
  | CommandPaletteActionItem
  | CommandPaletteRoomItem
  | CommandPaletteUserItem
  | CommandPaletteThreadItem
  | CommandPaletteMessageItem;
