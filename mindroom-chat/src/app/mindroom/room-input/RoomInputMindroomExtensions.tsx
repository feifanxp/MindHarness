import React from 'react';
import { MatrixClient, RelationType, Room } from 'matrix-js-sdk';
import { BaseRange, Descendant, Editor, Element, Transforms } from 'slate';
import { Box, config } from 'folds';
import { Membership } from '../../../types/matrix/room';
import type { AutocompleteQuery } from '../../components/editor/autocomplete/autocompleteQuery';
import type { PasteMarkerElement } from '../../components/editor/slate';
import { BlockType } from '../../components/editor/types';
import type { IReplyDraft, PendingVoiceSendContext } from '../../state/room/roomInputDrafts';
import { MindroomCommandAutocomplete } from '../commands/MindroomCommandAutocomplete';
import { getMindroomCommandQuery, MINDROOM_COMMAND_PREFIX } from '../commands/mindroomCommandQuery';
import { PendingSendIndicator } from '../messages/pendingSendIndicator';
import { ThreadIndicator } from '../threads/ThreadIndicator';
import { VoiceRecorderComposer } from '../voice/VoiceRecorderDialog';
import type { VoiceRecorderComposerHandle } from '../voice/VoiceRecorderDialog';
import { isSignalBridgeRoom } from '../bridges/bridgeDetection';
import {
  createRoomInputSendSessionState,
  getUploadRelationForSendSession,
} from '../threads/roomInputSendSession';
import type { TUploadContent } from '../../utils/matrix';
import type { MindroomPasteMarker } from '../messages/pasteAttachmentMarker';

export { useRoomInputSendSessionController } from '../threads/useRoomInputSendSessionController';

export type MindroomRoomInputAutocompletePrefix = typeof MINDROOM_COMMAND_PREFIX;
export type MindroomRoomInputAutocompleteQuery =
  AutocompleteQuery<MindroomRoomInputAutocompletePrefix>;

type MindroomRoomInputAutocompleteProps = {
  editor: Editor;
  query: AutocompleteQuery<string> | undefined;
  requestClose: () => void;
};

type MindroomRoomInputThreadIndicatorProps = {
  room: Room;
  relation: IReplyDraft['relation'] | undefined;
};
/**
 * Voice send context is the stricter PendingVoiceSendContext (with
 * ownerSessionId) so the parked failed-send atom can be account-scoped.
 * The broader RoomInputSendContext used for synchronous send sessions does
 * not need account stamping because it never outlives the active send.
 */
export type MindroomVoiceSendContext = PendingVoiceSendContext;
export type MindroomVoiceRecorderComposerHandle = VoiceRecorderComposerHandle;

type MindroomRoomInputReplyContextProps = {
  children?: React.ReactNode;
  leading?: React.ReactNode;
  pendingSend?: boolean;
  relation: IReplyDraft['relation'] | undefined;
  room: Room;
};

export const getMindroomRoomInputAutocompleteQuery = (
  editor: Editor,
  prevWordRange: BaseRange
): MindroomRoomInputAutocompleteQuery | undefined => getMindroomCommandQuery(editor, prevWordRange);

export const isMindroomRoomInputAutocompleteQuery = (
  query: AutocompleteQuery<string> | undefined
): query is MindroomRoomInputAutocompleteQuery => query?.prefix === MINDROOM_COMMAND_PREFIX;

export const getMindroomRoomInputVoiceSendContext = ({
  ownerSessionId,
  roomId,
  room,
  threadId,
  replyDraft,
  threadingEnabled = true,
}: {
  ownerSessionId: string;
  roomId: string;
  room: Room;
  threadId: string | undefined;
  replyDraft: IReplyDraft | undefined;
  threadingEnabled?: boolean;
}): MindroomVoiceSendContext => ({
  ownerSessionId,
  roomId,
  room,
  threadId,
  replyDraft,
  threadingEnabled,
  signalBridgedRoom: isSignalBridgeRoom(room),
});

/**
 * Re-resolve a captured voice send context against the live Matrix client
 * just before sending. Returns null if the source room is no longer
 * available (missing or non-Joined). This is the boundary that closes the
 * stale-snapshot window: encryption upgrades, membership changes, or
 * signal-bridge roster changes between original failure and retry are all
 * picked up here. handleVoiceSend in the parent uses this so the bridge-
 * detection / membership predicates stay isolated to the extensions module.
 */
export const refreshMindroomRoomInputVoiceSendContext = (
  mx: MatrixClient,
  context: MindroomVoiceSendContext
): MindroomVoiceSendContext | null => {
  const liveRoom = mx.getRoom(context.roomId);
  if (!liveRoom || liveRoom.getMyMembership() !== Membership.Join) return null;
  return {
    ...context,
    room: liveRoom,
    signalBridgedRoom: isSignalBridgeRoom(liveRoom),
  };
};

export const getMindroomRoomInputVoiceUploadRelation = (
  context: MindroomVoiceSendContext,
  file: TUploadContent
) => {
  const session = {
    threadId: context.threadId,
    replyDraft: context.replyDraft,
    ...createRoomInputSendSessionState({
      files: [file],
      hasText: false,
      threadId: context.threadId,
      replyDraft: context.replyDraft,
      threadingEnabled: context.threadingEnabled,
    }),
  };

  return getUploadRelationForSendSession(session, false);
};

export const createMindroomRoomInputPasteMarkerElement = (
  marker: MindroomPasteMarker
): PasteMarkerElement => ({
  type: BlockType.PasteMarker,
  id: marker.id,
  chars: marker.chars,
  fileName: marker.fileName,
  marker: marker.raw,
  children: [{ text: '' }],
});

export const isMindroomRoomInputPasteMarkerElement = (node: unknown): node is PasteMarkerElement =>
  Element.isElement(node) && node.type === BlockType.PasteMarker;

export const getMindroomRoomInputPasteMarkerFileNames = (nodes: Descendant[]): Set<string> => {
  const fileNames = new Set<string>();

  const visit = (node: Descendant) => {
    if (isMindroomRoomInputPasteMarkerElement(node)) {
      fileNames.add(node.fileName);
      return;
    }
    if (Element.isElement(node)) {
      node.children.forEach(visit);
    }
  };

  nodes.forEach(visit);
  return fileNames;
};

export const removeMindroomRoomInputPasteMarkerElements = (
  editor: Editor,
  fileNames: Set<string>
) => {
  if (fileNames.size === 0) return;

  Transforms.removeNodes(editor, {
    at: [],
    match: (node) => isMindroomRoomInputPasteMarkerElement(node) && fileNames.has(node.fileName),
  });
};

export function MindroomRoomInputAutocomplete({
  editor,
  query,
  requestClose,
}: MindroomRoomInputAutocompleteProps) {
  if (!isMindroomRoomInputAutocompleteQuery(query)) return null;

  return <MindroomCommandAutocomplete editor={editor} query={query} requestClose={requestClose} />;
}

export function MindroomRoomInputThreadIndicator({
  room,
  relation,
}: MindroomRoomInputThreadIndicatorProps) {
  if (relation?.rel_type !== RelationType.Thread) return null;

  return <ThreadIndicator room={room} />;
}

export function MindroomRoomInputReplyContext({
  children,
  leading,
  pendingSend,
  relation,
  room,
}: MindroomRoomInputReplyContextProps) {
  if (!leading && !children && !pendingSend) return null;

  return (
    <Box
      alignItems="Center"
      gap="300"
      style={{ padding: `${config.space.S200} ${config.space.S300} 0` }}
    >
      {leading}
      <Box direction="Row" gap="200" alignItems="Center">
        <MindroomRoomInputThreadIndicator room={room} relation={relation} />
        {children}
        {pendingSend && <PendingSendIndicator />}
      </Box>
    </Box>
  );
}

export { VoiceRecorderComposer as MindroomVoiceRecorderComposer };
