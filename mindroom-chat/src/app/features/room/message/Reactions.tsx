import React, { MouseEventHandler, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Text,
  Tooltip,
  TooltipProvider,
  as,
  toRem,
} from 'folds';
import classNames from 'classnames';
import { MatrixEvent, Room } from 'matrix-js-sdk';
import { type Relations } from 'matrix-js-sdk/lib/models/relations';
import FocusTrap from 'focus-trap-react';
import { Modal } from '../../../components/glass/GlassPrimitives';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { factoryEventSentBy } from '../../../utils/matrix';
import { isAgentStopButton, isStaleStopReactionKey } from '../../../mindroom/messages/stopReaction';
import { getActiveAnnotationsByKey } from '../../../utils/reactionAnnotations';
import { Reaction, ReactionTooltipMsg } from '../../../components/message';
import { useRelations } from '../../../hooks/useRelations';
import * as css from './styles.css';
import { ReactionViewer } from '../reaction-viewer';
import { stopPropagation } from '../../../utils/keyboard';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { isConfirmedMatrixEventId } from '../../../mindroom/threads/threadRouteUtils';

export type ReactionsProps = {
  room: Room;
  mEventId: string;
  /** Reaction target; used to suppress stale MindRoom stop chips. */
  targetEvent: MatrixEvent;
  canSendReaction?: boolean;
  relations: Relations;
  onReactionToggle: (
    targetEventId: string,
    key: string,
    shortcode?: string,
    relations?: Relations
  ) => void;
};
export const Reactions = as<'div', ReactionsProps>(
  (
    {
      className,
      room,
      relations,
      mEventId,
      targetEvent,
      canSendReaction,
      onReactionToggle,
      ...props
    },
    ref
  ) => {
    const { t } = useTranslation();
    const mx = useMatrixClient();
    const useAuthentication = useMediaAuthentication();
    const [viewer, setViewer] = useState<boolean | string>(false);
    const myUserId = mx.getUserId();
    const targetAllowsReactionToggle = canSendReaction && isConfirmedMatrixEventId(mEventId);
    const reactions = useRelations(relations, getActiveAnnotationsByKey);

    const handleViewReaction: MouseEventHandler<HTMLButtonElement> = (evt) => {
      evt.stopPropagation();
      evt.preventDefault();
      const key = evt.currentTarget.getAttribute('data-reaction-key');
      if (!key) setViewer(true);
      else setViewer(key);
    };

    return (
      <Box
        className={classNames(css.ReactionsContainer, className)}
        gap="200"
        wrap="Wrap"
        {...props}
        ref={ref}
      >
        {reactions.map(([key, events]) => {
          const rEvents = Array.from(events);
          if (rEvents.length === 0 || typeof key !== 'string') return null;
          // Per render, not in the selector: the final stream edit updates targetEvent in place.
          if (isStaleStopReactionKey(key, targetEvent)) return null;
          const myREvent = myUserId ? rEvents.find(factoryEventSentBy(myUserId)) : undefined;
          const isPressed = !!myREvent?.getRelation();
          const stopButton = isAgentStopButton(key, rEvents, targetEvent);

          return (
            <TooltipProvider
              key={key}
              position="Top"
              tooltip={
                <Tooltip style={{ maxWidth: toRem(200) }}>
                  <Text className={css.ReactionsTooltipText} size="T300">
                    {stopButton ? (
                      t('mindroomUi.messages.stopButton.tooltip')
                    ) : (
                      <ReactionTooltipMsg room={room} reaction={key} events={rEvents} />
                    )}
                  </Text>
                </Tooltip>
              }
            >
              {(targetRef) => (
                <Reaction
                  ref={targetRef}
                  data-reaction-key={key}
                  aria-pressed={isPressed}
                  key={key}
                  mx={mx}
                  reaction={key}
                  count={events.size}
                  label={stopButton ? t('mindroomUi.messages.stopButton.label') : undefined}
                  onClick={
                    targetAllowsReactionToggle
                      ? () => onReactionToggle(mEventId, key, undefined, relations)
                      : undefined
                  }
                  onContextMenu={handleViewReaction}
                  aria-disabled={!targetAllowsReactionToggle}
                  useAuthentication={useAuthentication}
                />
              )}
            </TooltipProvider>
          );
        })}
        {reactions.length > 0 && (
          <Overlay
            onContextMenu={(evt: any) => {
              evt.stopPropagation();
            }}
            open={!!viewer}
            backdrop={<OverlayBackdrop />}
          >
            <OverlayCenter>
              <FocusTrap
                focusTrapOptions={{
                  initialFocus: false,
                  returnFocusOnDeactivate: false,
                  onDeactivate: () => setViewer(false),
                  clickOutsideDeactivates: true,
                  escapeDeactivates: stopPropagation,
                }}
              >
                <Modal variant="Surface" size="300">
                  <ReactionViewer
                    room={room}
                    initialKey={typeof viewer === 'string' ? viewer : undefined}
                    relations={relations}
                    requestClose={() => setViewer(false)}
                  />
                </Modal>
              </FocusTrap>
            </OverlayCenter>
          </Overlay>
        )}
      </Box>
    );
  }
);
