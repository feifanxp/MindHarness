import React, { useLayoutEffect, useRef, useState } from 'react';
import type { Room } from 'matrix-js-sdk';
import {
  Box,
  Button,
  Icon,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  PopOut,
  Text,
  config,
  type RectCords,
} from 'folds';
import FocusTrap from 'focus-trap-react';
import { useTranslation } from 'react-i18next';
import { Dialog, Menu, MenuItem } from '../../components/glass/GlassPrimitives';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { usePowerLevels } from '../../hooks/usePowerLevels';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomMembers } from '../../hooks/useRoomMembers';
import { stopPropagation } from '../../utils/keyboard';
import { copyToClipboard } from '../../utils/dom';
import { getMatrixToRoomEvent } from '../../plugins/matrix-to';
import { getViaServers } from '../../plugins/via-servers';
import { isMindroomAgentUserId } from '../matrix/agentIdentity';
import { useThreadTags } from './useThreadTags';
import { useMutateThreadTags } from './useMutateThreadTags';
import { useThreadPinning } from './useThreadPinning';
import { ThreadTagPicker } from './ThreadTagPicker';
import { ThreadTagPill } from './ThreadTagPill';
import { isConfirmedMatrixEventId } from './threadRouteUtils';
import { getResolvableThreadRootEvent } from './threadResolvableRoot';
import {
  getThreadSummaryActionError,
  normalizeSummaryText,
  requestThreadSummary,
  saveThreadSummary,
  SUMMARY_MAX_LENGTH,
} from './threadSummaryActions';

export type ThreadActionsMenuProps = {
  room: Room;
  rootId: string;
  summaryText?: string;
  anchor: RectCords;
  onClose: () => void;
  onOpenThread?: () => void;
  /** The open thread's banner offers to collapse itself here. */
  onHideDetails?: () => void;
};
export function ThreadActionsMenu({
  room,
  rootId,
  summaryText,
  anchor,
  onClose,
  onOpenThread,
  onHideDetails,
}: ThreadActionsMenuProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const confirmed = isConfirmedMatrixEventId(rootId);
  const tags = useThreadTags(room, rootId);
  const mutations = useMutateThreadTags(room);
  const pinning = useThreadPinning(room);
  const pinned = pinning.pinnedEventIds.includes(rootId);
  // Keep permission changes reactive while sharing the policy with the write helpers.
  usePowerLevels(room);
  useRoomCreators(room);
  const joined = room.getMyMembership() === 'join';
  const canSend = !getThreadSummaryActionError(mx, room, rootId);
  const canEditTags =
    confirmed && joined && tags.canEdit && !!getResolvableThreadRootEvent(room, rootId);
  const tagsLabel = canEditTags ? 'threadActions.tags' : 'thread.stats.tags';
  const members = useRoomMembers(mx, room.roomId);
  const agents = members.filter(
    (member) =>
      member.membership === 'join' &&
      isMindroomAgentUserId(member.userId) &&
      member.userId !== mx.getSafeUserId()
  );
  const [mode, setMode] = useState<'menu' | 'tags' | 'editSummary' | 'regenerate'>('menu');
  const menuActive = useRef(true);
  const openDialog = (next: 'tags' | 'editSummary' | 'regenerate') => {
    menuActive.current = false;
    if (next === 'editSummary') setDraft(summaryText ?? '');
    setMode(next);
  };
  const [draft, setDraft] = useState(summaryText ?? '');
  const [agentId, setAgentId] = useState('');
  const selectedAgent = agentId ? agents.find((agent) => agent.userId === agentId) : agents[0];
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [requested, setRequested] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  const busy = saving || mutations.updating || pinning.updating;
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    busyRef.current = busy;
    onCloseRef.current = onClose;
  }, [busy, onClose]);
  const close = () => {
    if (!pending.current && !busyRef.current) onCloseRef.current();
  };
  const actionFailed = !!(error || mutations.error || pinning.error);
  const failure = actionFailed && (
    <Text role="alert" size="T300">
      {t('threadActions.failed')}
    </Text>
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending.current || !canSend || requested) return;
    pending.current = true;
    setSaving(true);
    setError(false);
    try {
      if (mode === 'editSummary') {
        await saveThreadSummary(mx, room, rootId, draft);
        onClose();
      } else if (mode === 'regenerate' && selectedAgent) {
        await requestThreadSummary(mx, room, rootId, selectedAgent.userId);
        setRequested(true);
      }
    } catch {
      setError(true);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  const item = (
    action: string,
    label: string,
    icon: React.ComponentProps<typeof Icon>['src'],
    onClick: () => void,
    disabled = false
  ) => (
    <MenuItem
      role="menuitem"
      type="button"
      size="300"
      radii="300"
      onClick={onClick}
      disabled={disabled}
      data-thread-action={action}
      after={<Icon size="100" src={icon} />}
    >
      <Box grow="Yes">
        <Text size="T300">{label}</Text>
      </Box>
    </MenuItem>
  );

  if (mode === 'menu')
    return (
      <PopOut
        anchor={anchor}
        offset={anchor.width === 0 ? 0 : 5}
        position="Bottom"
        align="Start"
        content={
          <FocusTrap
            focusTrapOptions={{
              onDeactivate: () => {
                if (menuActive.current) close();
              },
              clickOutsideDeactivates: () => !busyRef.current,
              returnFocusOnDeactivate: false,
              escapeDeactivates: (event) => {
                stopPropagation(event);
                return !busyRef.current;
              },
              isKeyForward: (event) => event.key === 'ArrowDown',
              isKeyBackward: (event) => event.key === 'ArrowUp',
            }}
          >
            <Menu
              role="menu"
              aria-label={t('threadActions.more')}
              style={{ minWidth: '14rem', maxWidth: 'calc(100vw - 24px)' }}
            >
              <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
                {onOpenThread && item('open', t('threadActions.open'), Icons.Message, onOpenThread)}
                {/* Readers can still list tags: short screens drop them from the banner. */}
                {(canEditTags || (confirmed && tags.displayTags.length > 0)) &&
                  item('tags', t(tagsLabel), Icons.Bookmark, () => openDialog('tags'), busy)}
                {canSend &&
                  item(
                    'editSummary',
                    t('threadActions.editSummary'),
                    Icons.Pencil,
                    () => openDialog('editSummary'),
                    busy
                  )}
                {canSend &&
                  item(
                    'regenerate',
                    t('threadActions.regenerate'),
                    Icons.Bulb,
                    () => openDialog('regenerate'),
                    busy
                  )}
                {canEditTags &&
                  !pinned &&
                  item(
                    'resolve',
                    t(tags.isResolved ? 'threadActions.reopen' : 'thread.resolve'),
                    Icons.CheckTwice,
                    () => {
                      void mutations.setResolved(rootId, !tags.isResolved);
                    },
                    busy
                  )}
                {confirmed &&
                  joined &&
                  pinning.canPin &&
                  item(
                    'pin',
                    t(pinned ? 'threadNav.unpin' : 'threadNav.pin'),
                    Icons.Pin,
                    () => {
                      void pinning.setPinned(rootId, !pinned);
                    },
                    busy
                  )}
                {confirmed &&
                  item('copy', t('threadActions.copy'), Icons.Link, () => {
                    void copyToClipboard(
                      getMatrixToRoomEvent(room.roomId, rootId, getViaServers(room))
                    )
                      .then((copied) => {
                        if (copied) onClose();
                        else setError(true);
                      })
                      .catch(() => setError(true));
                  })}
                {onHideDetails &&
                  item('hideDetails', t('thread.hideDetails'), Icons.ChevronTop, () => {
                    onHideDetails();
                    onClose();
                  })}
                {failure}
              </Box>
            </Menu>
          </FocusTrap>
        }
      />
    );

  const normalizedDraft = normalizeSummaryText(draft);
  const draftLength = Array.from(normalizedDraft).length;
  const title = t(mode === 'tags' ? tagsLabel : `threadActions.${mode}`);
  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            onDeactivate: close,
            fallbackFocus: () => dialogRef.current ?? document.body,
            clickOutsideDeactivates: () => !busyRef.current,
            escapeDeactivates: (event) => {
              stopPropagation(event);
              return !busyRef.current;
            },
            returnFocusOnDeactivate: false,
          }}
        >
          <Dialog
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
            aria-modal="true"
            aria-label={title}
            style={{ width: 'min(480px, calc(100vw - 24px))' }}
          >
            <Box direction="Column" gap="400" style={{ padding: config.space.S400 }}>
              <Text as="h2" size="H4">
                {title}
              </Text>
              {mode === 'tags' ? (
                <>
                  <Box wrap="Wrap" gap="200">
                    {tags.displayTags.map((tag) => (
                      <ThreadTagPill
                        key={tag}
                        name={tag}
                        onRemove={
                          canEditTags && !busy
                            ? () => {
                                void mutations.removeTag(rootId, tag);
                              }
                            : undefined
                        }
                      />
                    ))}
                    {canEditTags && (
                      <ThreadTagPicker
                        availableTags={tags.availableTags}
                        disabled={busy}
                        onAddTag={(tag) => {
                          void mutations.addTag(rootId, tag);
                        }}
                      />
                    )}
                  </Box>
                  {failure}
                  <Button onClick={close} disabled={busy} fill="Soft" outlined radii="300">
                    <Text>{t('threadActions.done')}</Text>
                  </Button>
                </>
              ) : (
                <form onSubmit={submit}>
                  <Box direction="Column" gap="300">
                    {mode === 'editSummary' ? (
                      <>
                        <Text as="label" htmlFor="thread-summary" size="T300">
                          {t('threadActions.summary')}
                        </Text>
                        <textarea
                          id="thread-summary"
                          rows={4}
                          value={draft}
                          disabled={saving || !canSend}
                          onChange={(event) => setDraft(event.target.value)}
                          style={{
                            width: '100%',
                            resize: 'vertical',
                            padding: config.space.S200,
                            font: 'inherit',
                            color: 'inherit',
                            background: 'transparent',
                          }}
                        />
                        <Text size="T200" priority="300">
                          {t('threadActions.summaryHint')}
                        </Text>
                        <Text size="T200">
                          {t('threadActions.length', {
                            count: draftLength,
                            max: SUMMARY_MAX_LENGTH,
                          })}
                        </Text>
                      </>
                    ) : (
                      <>
                        <Text size="T300">{t('threadActions.regenerateHint')}</Text>
                        <Text as="label" htmlFor="thread-summary-agent" size="T300">
                          {t('threadActions.agent')}
                        </Text>
                        <select
                          id="thread-summary-agent"
                          value={selectedAgent?.userId ?? ''}
                          disabled={saving || requested || !canSend}
                          onChange={(event) => setAgentId(event.target.value)}
                        >
                          {agents.length === 0 && (
                            <option value="">{t('threadActions.noAgents')}</option>
                          )}
                          {agents.map((agent) => (
                            <option key={agent.userId} value={agent.userId}>
                              {agent.name || agent.userId}
                            </option>
                          ))}
                        </select>
                        {requested && (
                          <Text role="status" size="T300">
                            {t('threadActions.requested')}
                          </Text>
                        )}
                      </>
                    )}
                    {failure}
                    <Box gap="200" justifyContent="End">
                      <Button
                        type="button"
                        variant="Secondary"
                        fill="Soft"
                        onClick={close}
                        disabled={busy}
                        outlined
                        radii="300"
                      >
                        <Text>{t(requested ? 'threadActions.done' : 'threadActions.cancel')}</Text>
                      </Button>
                      {!requested && (
                        <Button
                          type="submit"
                          disabled={
                            busy ||
                            !canSend ||
                            (mode === 'editSummary'
                              ? !normalizedDraft || draftLength > SUMMARY_MAX_LENGTH
                              : !selectedAgent)
                          }
                          fill="Soft"
                          outlined
                          radii="300"
                        >
                          <Text>
                            {t(
                              saving
                                ? 'threadActions.saving'
                                : mode === 'editSummary'
                                ? 'threadActions.save'
                                : 'threadActions.sendRequest'
                            )}
                          </Text>
                        </Button>
                      )}
                    </Box>
                  </Box>
                </form>
              )}
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
