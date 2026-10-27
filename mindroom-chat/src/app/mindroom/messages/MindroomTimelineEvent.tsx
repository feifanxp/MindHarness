import { Box, Icon, IconButton, Icons, Line, PopOut, RectCords, as } from 'folds';
import React, { MouseEventHandler, useState } from 'react';
import FocusTrap from 'focus-trap-react';
import { useTranslation } from 'react-i18next';
import { useFocusWithin, useHover } from 'react-aria';
import { MatrixEvent, Room } from 'matrix-js-sdk';
import classNames from 'classnames';
import { Menu } from '../../components/glass/GlassPrimitives';
import { IconTooltip } from '../tooltip/IconTooltip';
import { MessageBase } from '../../components/message';
import { MessageSpacing } from '../../state/settings';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import * as css from '../../features/room/message/styles.css';
import { stopPropagation } from '../../utils/keyboard';
import { isConfirmedMatrixEventId } from '../threads/threadRouteUtils';
import { MessageReadReceiptItem, MessageSourceCodeItem } from './MessageInspectionActions';
import { MessageCopyLinkItem } from './MessageCopyActions';
import { MessageDeleteItem, MessageReportItem } from './MessageModerationActions';

export type EventProps = {
  room: Room;
  mEvent: MatrixEvent;
  highlight: boolean;
  canDelete?: boolean;
  messageSpacing: MessageSpacing;
  hideReadReceipts?: boolean;
  showDeveloperTools?: boolean;
};
export const Event = as<'div', EventProps>(
  (
    {
      className,
      room,
      mEvent,
      highlight,
      canDelete,
      messageSpacing,
      hideReadReceipts,
      showDeveloperTools,
      children,
      ...props
    },
    ref
  ) => {
    const { t } = useTranslation();
    const mx = useMatrixClient();
    const [hover, setHover] = useState(false);
    const { hoverProps } = useHover({ onHoverChange: setHover });
    const { focusWithinProps } = useFocusWithin({ onFocusWithinChange: setHover });
    const [menuAnchor, setMenuAnchor] = useState<RectCords>();
    const stateEvent = typeof mEvent.getStateKey() === 'string';
    const serverEventActionsAllowed = isConfirmedMatrixEventId(mEvent.getId());

    const handleContextMenu: MouseEventHandler<HTMLDivElement> = (evt) => {
      if (evt.altKey || !window.getSelection()?.isCollapsed) return;
      const tag = (evt.target as any).tagName;
      if (typeof tag === 'string' && tag.toLowerCase() === 'a') return;
      evt.preventDefault();
      setMenuAnchor({
        x: evt.clientX,
        y: evt.clientY,
        width: 0,
        height: 0,
      });
    };

    const handleOpenMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
      const target = evt.currentTarget.parentElement?.parentElement ?? evt.currentTarget;
      setMenuAnchor(target.getBoundingClientRect());
    };

    const closeMenu = () => {
      setMenuAnchor(undefined);
    };

    return (
      <MessageBase
        className={classNames(css.MessageBase, className)}
        tabIndex={0}
        space={messageSpacing}
        autoCollapse
        highlight={highlight}
        selected={!!menuAnchor}
        {...props}
        {...hoverProps}
        {...focusWithinProps}
        ref={ref}
      >
        {(hover || !!menuAnchor) && (
          <div className={css.MessageOptionsBase}>
            <Menu className={css.MessageOptionsBar} variant="SurfaceVariant">
              <Box gap="100">
                <PopOut
                  anchor={menuAnchor}
                  position="Bottom"
                  align={menuAnchor?.width === 0 ? 'Start' : 'End'}
                  offset={menuAnchor?.width === 0 ? 0 : undefined}
                  content={
                    <FocusTrap
                      focusTrapOptions={{
                        initialFocus: false,
                        onDeactivate: () => setMenuAnchor(undefined),
                        clickOutsideDeactivates: true,
                        isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
                        isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
                        escapeDeactivates: stopPropagation,
                      }}
                    >
                      <Menu {...props} ref={ref}>
                        <Box direction="Column" gap="100" className={css.MessageMenuGroup}>
                          {!hideReadReceipts && (
                            <MessageReadReceiptItem
                              room={room}
                              eventId={mEvent.getId() ?? ''}
                              onClose={closeMenu}
                            />
                          )}
                          {showDeveloperTools && (
                            <MessageSourceCodeItem
                              room={room}
                              mEvent={mEvent}
                              onClose={closeMenu}
                            />
                          )}
                          {serverEventActionsAllowed && (
                            <MessageCopyLinkItem room={room} mEvent={mEvent} onClose={closeMenu} />
                          )}
                        </Box>
                        {serverEventActionsAllowed &&
                          ((!mEvent.isRedacted() && canDelete && !stateEvent) ||
                            (mEvent.getSender() !== mx.getUserId() && !stateEvent)) && (
                            <>
                              <Line size="300" />
                              <Box direction="Column" gap="100" className={css.MessageMenuGroup}>
                                {!mEvent.isRedacted() && canDelete && (
                                  <MessageDeleteItem
                                    room={room}
                                    mEvent={mEvent}
                                    onClose={closeMenu}
                                  />
                                )}
                                {mEvent.getSender() !== mx.getUserId() && (
                                  <MessageReportItem
                                    room={room}
                                    mEvent={mEvent}
                                    onClose={closeMenu}
                                  />
                                )}
                              </Box>
                            </>
                          )}
                      </Menu>
                    </FocusTrap>
                  }
                >
                  <IconTooltip
                    label={t('mindroomUi.messages.mindroomMessage.moreOptions')}
                    position="Top"
                  >
                    {(triggerRef) => (
                      <IconButton
                        ref={triggerRef}
                        aria-label={t('mindroomUi.messages.mindroomMessage.moreOptions')}
                        variant="SurfaceVariant"
                        size="300"
                        radii="300"
                        onClick={handleOpenMenu}
                        aria-pressed={!!menuAnchor}
                      >
                        <Icon src={Icons.VerticalDots} size="100" />
                      </IconButton>
                    )}
                  </IconTooltip>
                </PopOut>
              </Box>
            </Menu>
          </div>
        )}
        <div onContextMenu={handleContextMenu}>{children}</div>
      </MessageBase>
    );
  }
);
