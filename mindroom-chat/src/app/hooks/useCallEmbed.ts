import { createContext, RefObject, useCallback, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MatrixClient, Room } from 'matrix-js-sdk';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import {
  CallEmbed,
  ElementCallThemeKind,
  ElementWidgetActions,
  useClientWidgetApiEvent,
} from '../plugins/call';
import { useMatrixClient } from './useMatrixClient';
import { ThemeKind, useTheme } from './useTheme';
import { callEmbedAtom, callEndRequestAtom } from '../state/callEmbed';
import { useResizeObserver } from './useResizeObserver';
import { CallControlState } from '../plugins/call/CallControlState';
import { useCallMembersChange, useCallSession } from './useCall';
import { CallPreferences } from '../state/callPreferences';
import { useAppLanguageCode } from './useAppLanguageCode';

const CallEmbedContext = createContext<CallEmbed | undefined>(undefined);

export const CallEmbedContextProvider = CallEmbedContext.Provider;

export const useCallEmbed = (): CallEmbed | undefined => {
  const callEmbed = useContext(CallEmbedContext);

  return callEmbed;
};

const CallEmbedRefContext = createContext<RefObject<HTMLDivElement> | undefined>(undefined);
export const CallEmbedRefContextProvider = CallEmbedRefContext.Provider;
export const useCallEmbedRef = (): RefObject<HTMLDivElement> => {
  const ref = useContext(CallEmbedRefContext);
  if (!ref) {
    throw new Error('CallEmbedRef is not provided!');
  }
  return ref;
};

export const createCallEmbed = (
  mx: MatrixClient,
  room: Room,
  dm: boolean,
  themeKind: ElementCallThemeKind,
  language: string,
  iframeTitle: string,
  container: HTMLElement,
  pref?: CallPreferences
): CallEmbed => {
  const rtcSession = mx.matrixRTC.getRoomSession(room);
  const ongoing = rtcSession.memberships.length > 0;

  const intent = CallEmbed.getIntent(dm, ongoing, pref?.video);
  const widget = CallEmbed.getWidget(mx, room, intent, themeKind, language);
  const controlState = pref && new CallControlState(pref.microphone, pref.video, pref.sound);

  const embed = new CallEmbed(mx, room, widget, container, iframeTitle, controlState);

  return embed;
};

export const useCallStart = (dm = false) => {
  const mx = useMatrixClient();
  const theme = useTheme();
  const language = useAppLanguageCode();
  const { t } = useTranslation();
  const iframeTitle = t('mindroomUi.calls.agentCallButton.call');
  const setCallEmbed = useSetAtom(callEmbedAtom);
  // Surfaces like user profiles mount this hook for every rendered user, so a
  // missing CallEmbedRef provider must fail when a call is started (catchable
  // by the caller), never during render of the host surface.
  const callEmbedRef = useContext(CallEmbedRefContext);

  const startCall = useCallback(
    (room: Room, pref?: CallPreferences) => {
      const container = callEmbedRef?.current;
      if (!container) {
        throw new Error('Failed to start call, No embed container element found!');
      }
      const callEmbed = createCallEmbed(
        mx,
        room,
        dm,
        theme.kind,
        language,
        iframeTitle,
        container,
        pref
      );

      setCallEmbed(callEmbed);
    },
    [mx, dm, theme, language, iframeTitle, setCallEmbed, callEmbedRef]
  );

  return startCall;
};

export const useCallJoined = (embed?: CallEmbed): boolean => {
  const [joined, setJoined] = useState(embed?.joined ?? false);

  useClientWidgetApiEvent(
    embed?.call,
    ElementWidgetActions.JoinCall,
    useCallback(() => {
      setJoined(true);
    }, [])
  );

  useEffect(() => {
    setJoined(embed?.joined ?? false);
  }, [embed]);

  return joined;
};

export const useCallHangupEvent = (embed: CallEmbed, callback: () => void) => {
  useClientWidgetApiEvent(embed.call, ElementWidgetActions.HangupCall, callback);
  useClientWidgetApiEvent(embed.call, ElementWidgetActions.Close, callback);
};

export const CALL_END_FALLBACK_MS = 4_000;

/** Share one bounded End request between every surface for the current call. */
export const useCallEnd = (
  embed: CallEmbed,
  requestHangup = true
): readonly [boolean, () => void] => {
  const endRequest = useAtomValue(callEndRequestAtom);
  const setEndRequest = useSetAtom(callEndRequestAtom);
  const store = useStore();

  const endCall = useCallback(() => {
    if (store.get(callEndRequestAtom)?.embed === embed) return;
    setEndRequest({ embed, requestHangup });
    if (!requestHangup) return;
    void Promise.resolve()
      .then(() => embed.hangup())
      .catch(() => undefined);
  }, [embed, requestHangup, setEndRequest, store]);

  return [endRequest?.embed === embed, endCall] as const;
};

/** Keep healthy widget completion and the bounded host fallback on one path. */
export const useCallEndLifecycle = (embed: CallEmbed, finish: () => void): void => {
  const endRequest = useAtomValue(callEndRequestAtom);
  useCallHangupEvent(embed, finish);

  useEffect(() => {
    if (endRequest?.embed !== embed) return undefined;
    if (!endRequest.requestHangup) {
      finish();
      return undefined;
    }
    const timeout = window.setTimeout(finish, CALL_END_FALLBACK_MS);
    return () => window.clearTimeout(timeout);
  }, [embed, endRequest, finish]);
};

export const useCallMemberSoundSync = (embed: CallEmbed) => {
  const callSession = useCallSession(embed.room);
  useCallMembersChange(
    callSession,
    useCallback(() => embed.control.applySound(), [embed])
  );
};

export const useCallThemeSync = (embed: CallEmbed) => {
  const theme = useTheme();

  useEffect(() => {
    const name: ElementCallThemeKind = theme.kind === ThemeKind.Dark ? 'dark' : 'light';

    embed.setTheme(name);
  }, [theme.kind, embed]);
};

export const useCallEmbedTitleSync = (embed: CallEmbed): void => {
  const { t } = useTranslation();
  const iframeTitle = t('mindroomUi.calls.agentCallButton.call');

  useEffect(() => {
    embed.setTitle(iframeTitle);
  }, [embed, iframeTitle]);
};

export const getCallEmbedViewportPlacement = (
  container: HTMLDivElement
): { top: string; left: string; width: string; height: string } => {
  const { top, left, width, height } = container.getBoundingClientRect();

  return {
    top: `${top}px`,
    left: `${left}px`,
    width: `${width}px`,
    height: `${height}px`,
  };
};

export const useCallEmbedPlacementSync = (containerViewRef: RefObject<HTMLDivElement>): void => {
  const callEmbedRef = useCallEmbedRef();

  const syncCallEmbedPlacement = useCallback(() => {
    const embedEl = callEmbedRef.current;
    const container = containerViewRef.current;
    if (!embedEl || !container) return;

    Object.assign(embedEl.style, getCallEmbedViewportPlacement(container));
  }, [callEmbedRef, containerViewRef]);

  useResizeObserver(
    syncCallEmbedPlacement,
    useCallback(() => containerViewRef.current, [containerViewRef])
  );
};
