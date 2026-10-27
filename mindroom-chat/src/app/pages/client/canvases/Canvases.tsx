import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Box, Icon, IconButton, Icons, Text } from 'folds';
import { KnownMembership, type Room } from 'matrix-js-sdk';
import { Page, PageContent, PageHeader, PageScroll } from '../../../components/page';
import { useAccountData } from '../../../hooks/useAccountData';
import { useAppLanguageCode } from '../../../hooks/useAppLanguageCode';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useRoomNavigate } from '../../../hooks/useRoomNavigate';
import { getMxIdLocalPart } from '../../../utils/matrix';
import { getMemberDisplayName } from '../../../utils/room';
import {
  canvasSessionId,
  loadCanvasEvent,
  recordCanvasEvent,
  watchCanvasIndex,
} from '../../../mindroom/canvas/canvasIndex';
import { listCanvases, type CanvasListEntry } from '../../../mindroom/canvas/canvasIndexStore';
import { listSavedCanvasIds } from '../../../mindroom/canvas/canvasStateStore';
import {
  PINNED_CANVASES_TYPE,
  readPinnedCanvases,
  setCanvasPinned,
  type PinnedCanvas,
} from '../../../mindroom/canvas/pinnedCanvases';
import { cancelCanvasOpen, requestCanvasOpen } from '../../../mindroom/canvas/useCanvasOpenRequest';
import { useRecentThreadViewModel } from '../../../mindroom/threads/recentThreadViewModel';
import * as css from './Canvases.css';

type CanvasList = { entries?: CanvasListEntry[]; savedIds: Set<string> };

/** This session's listed canvases and which hold saved state, re-read after each change. */
const useCanvasList = (sessionId: string): CanvasList => {
  const [list, setList] = useState<CanvasList>({ savedIds: new Set() });
  useEffect(
    () =>
      watchCanvasIndex(
        () =>
          Promise.all([
            listCanvases(sessionId).catch(() => []),
            listSavedCanvasIds(sessionId).catch(() => []),
          ]),
        ([entries, savedIds]) => setList({ entries, savedIds: new Set(savedIds) })
      ),
    [sessionId]
  );
  return list;
};

/** Pins from account data, showing each change here at once until its write settles. */
const usePinnedCanvases = () => {
  const mx = useMatrixClient();
  const pinEvent = useAccountData(PINNED_CANVASES_TYPE);
  const stored = useMemo(() => readPinnedCanvases(pinEvent?.getContent()), [pinEvent]);
  const [wanted, setWanted] = useState(new Map<string, { pin: PinnedCanvas; pinned: boolean }>());
  const pins = useMemo(
    () => [
      ...stored.filter((pin) => wanted.get(pin.canvasId)?.pinned !== false),
      ...[...wanted.values()]
        .filter(
          (change) => change.pinned && !stored.some((pin) => pin.canvasId === change.pin.canvasId)
        )
        .map((change) => change.pin),
    ],
    [stored, wanted]
  );
  const toggle = (entry: CanvasListEntry) => {
    const change = {
      pin: { roomId: entry.roomId, canvasId: entry.canvasId },
      pinned: !pins.some((pin) => pin.canvasId === entry.canvasId),
    };
    setWanted((current) => new Map(current).set(entry.canvasId, change));
    setCanvasPinned(mx, change.pin, change.pinned)
      .catch(() => undefined)
      .finally(() =>
        setWanted((current) => {
          // A later click on the same canvas still waits for its own write.
          if (current.get(entry.canvasId) !== change) return current;
          const next = new Map(current);
          next.delete(entry.canvasId);
          return next;
        })
      );
  };
  return { pins, toggle };
};

/** The thread's name as the sidebar's Threads list shows it: its summary, or its first message. */
function ThreadName({ room, threadId }: { room: Room; threadId: string }) {
  return <>{useRecentThreadViewModel(room, threadId, 0).summaryText}</>;
}

export function Canvases() {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const mx = useMatrixClient();
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const { entries, savedIds } = useCanvasList(canvasSessionId(mx));
  const { pins, toggle } = usePinnedCanvases();
  // Coming back here abandons a canvas this page asked a room to open.
  useEffect(() => cancelCanvasOpen(), []);

  // A canvas pinned on another device may be missing here; it is fetched and listed once.
  const fetched = useRef(new Set<string>());
  useEffect(() => {
    if (!entries) return;
    pins.forEach((pin) => {
      const room = mx.getRoom(pin.roomId);
      if (!room || fetched.current.has(pin.canvasId)) return;
      if (entries.some((entry) => entry.canvasId === pin.canvasId)) return;
      fetched.current.add(pin.canvasId);
      loadCanvasEvent(mx, room, pin.canvasId)
        .then((event) => event && recordCanvasEvent(mx, event))
        .catch(() => undefined);
    });
  }, [mx, entries, pins]);

  const rows = useMemo(() => {
    const pinOrder = new Map(pins.map((pin, index) => [pin.canvasId, index]));
    return (entries ?? [])
      .filter((entry) => mx.getRoom(entry.roomId)?.getMyMembership() === KnownMembership.Join)
      .sort(
        (a, b) =>
          (pinOrder.get(a.canvasId) ?? Infinity) - (pinOrder.get(b.canvasId) ?? Infinity) ||
          b.updatedTs - a.updatedTs
      );
  }, [mx, entries, pins]);

  const date = useMemo(
    () => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }),
    [language]
  );
  const open = (entry: CanvasListEntry, target: 'canvas' | 'thread' | 'room') => {
    if (target === 'canvas') requestCanvasOpen(entry.roomId, entry.canvasId);
    else cancelCanvasOpen();
    if (target !== 'room' && entry.threadId) navigateRoomThread(entry.roomId, entry.threadId);
    else navigateRoom(entry.roomId);
  };

  return (
    <Page data-testid="canvases-view">
      <PageHeader>
        <Box grow="Yes" alignItems="Center" gap="200">
          <Icon src={Icons.Category} size="300" />
          <Text as="h1" size="H3" truncate>
            {t('mindroomUi.canvases.title')}
          </Text>
        </Box>
      </PageHeader>
      <PageScroll>
        <PageContent>
          <Text size="T300" priority="300" className={css.Note}>
            {t('mindroomUi.canvases.note')}
          </Text>
          {entries && rows.length === 0 && (
            <Text size="T300" className={css.Empty}>
              {t('mindroomUi.canvases.empty')}
            </Text>
          )}
          {rows.length > 0 && (
            <div className={css.TableScroll}>
              <table className={css.Table}>
                <thead>
                  <tr>
                    <th aria-label={t('mindroomUi.canvases.pinned')} />
                    <th>{t('mindroomUi.canvases.canvas')}</th>
                    <th>{t('mindroomUi.canvases.thread')}</th>
                    <th>{t('mindroomUi.canvases.room')}</th>
                    <th>{t('mindroomUi.canvases.agent')}</th>
                    <th>{t('mindroomUi.canvases.updated')}</th>
                    <th>{t('mindroomUi.canvases.created')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((entry) => {
                    const room = mx.getRoom(entry.roomId);
                    const pinned = pins.some((pin) => pin.canvasId === entry.canvasId);
                    const agent =
                      (room && getMemberDisplayName(room, entry.agentUserId)) ??
                      getMxIdLocalPart(entry.agentUserId) ??
                      entry.agentUserId;
                    return (
                      <tr key={entry.canvasId}>
                        <td>
                          <IconButton
                            size="300"
                            radii="300"
                            variant={pinned ? 'Primary' : 'Background'}
                            aria-pressed={pinned}
                            aria-label={t(
                              pinned ? 'mindroomUi.canvases.unpin' : 'mindroomUi.canvases.pin',
                              { title: entry.title }
                            )}
                            onClick={() => toggle(entry)}
                          >
                            <Icon size="100" src={Icons.Pin} filled={pinned} />
                          </IconButton>
                        </td>
                        <td>
                          <Box direction="Column" gap="100" alignItems="Start">
                            <button
                              type="button"
                              className={css.Link}
                              onClick={() => open(entry, 'canvas')}
                            >
                              <Text size="T300" as="span">
                                <b>{entry.title}</b>
                              </Text>
                            </button>
                            {(entry.shared || savedIds.has(entry.canvasId)) && (
                              <Box gap="100" wrap="Wrap">
                                {entry.shared && (
                                  <Badge variant="Secondary" fill="Soft" radii="300">
                                    <Text size="L400">{t('mindroomUi.canvases.shared')}</Text>
                                  </Badge>
                                )}
                                {savedIds.has(entry.canvasId) && (
                                  <Badge variant="Secondary" fill="Soft" radii="300">
                                    <Text size="L400">{t('mindroomUi.canvases.saved')}</Text>
                                  </Badge>
                                )}
                              </Box>
                            )}
                          </Box>
                        </td>
                        <td>
                          {room && entry.threadId && (
                            <button
                              type="button"
                              className={css.Link}
                              onClick={() => open(entry, 'thread')}
                            >
                              <Text size="T300" as="span">
                                <ThreadName room={room} threadId={entry.threadId} />
                              </Text>
                            </button>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className={css.Link}
                            onClick={() => open(entry, 'room')}
                          >
                            <Text size="T300" as="span">
                              {room?.name ?? entry.roomId}
                            </Text>
                          </button>
                        </td>
                        <td>
                          <Text size="T300">{agent}</Text>
                        </td>
                        <td>
                          <Text size="T300">{date.format(entry.updatedTs)}</Text>
                        </td>
                        <td>
                          <Text size="T300">{date.format(entry.createdTs)}</Text>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </PageContent>
      </PageScroll>
    </Page>
  );
}
