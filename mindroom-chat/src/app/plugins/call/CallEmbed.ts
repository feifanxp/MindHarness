import {
  ClientEvent,
  KnownMembership,
  MatrixClient,
  MatrixEvent,
  MatrixEventEvent,
  Room,
  RoomStateEvent,
} from 'matrix-js-sdk';
import { logger } from 'matrix-js-sdk/lib/logger';
import {
  ClientWidgetApi,
  IRoomEvent,
  IWidget,
  Widget,
  WidgetApiToWidgetAction,
} from 'matrix-widget-api';
import { CallWidgetDriver } from './CallWidgetDriver';
import { trimTrailingSlash } from '../../utils/common';
import {
  ElementCallIntent,
  ElementCallThemeKind,
  ElementMediaStateDetail,
  ElementWidgetActions,
} from './types';
import { CallControl } from './CallControl';
import { CallControlState } from './CallControlState';

const ELEMENT_CALL_LANGUAGE_CODES: Record<string, string> = {
  zh: 'zh-Hans',
  'zh-TW': 'zh-Hant',
};

/**
 * The widget API listens on the whole window and otherwise trusts any message that names the
 * widget. Element Call is served from Chat's own origin, so only same-origin messages are its;
 * this keeps other frames (such as agent canvases, whose origin is opaque) from driving the call.
 */
export const restrictCallTransportToSameOrigin = (call: Pick<ClientWidgetApi, 'transport'>) => {
  // eslint-disable-next-line no-param-reassign
  call.transport.strictOriginCheck = true;
};

export class CallEmbed {
  private mx: MatrixClient;

  public readonly call: ClientWidgetApi;

  public readonly iframe: HTMLIFrameElement;

  public readonly room: Room;

  public joined = false;

  /** Server timestamp of the room's newest event when the call started; earlier failure notices belong to an earlier call. */
  public readonly startedAfterTs: number | undefined;

  public readonly control: CallControl;

  private readonly container: HTMLElement;

  private readonly callWidgetDriver: CallWidgetDriver;

  private readUpToMap: { [roomId: string]: string } = {}; // room ID to event ID

  private eventsToFeed = new WeakSet<MatrixEvent>();

  private readonly disposables: Array<() => void> = [];

  private disposed = false;

  static getIntent(dm: boolean, ongoing: boolean, video?: boolean): ElementCallIntent {
    if (dm && ongoing) {
      return video ? ElementCallIntent.JoinExistingDM : ElementCallIntent.JoinExistingDMVoice;
    }
    if (dm) {
      return video ? ElementCallIntent.StartCallDM : ElementCallIntent.StartCallDMVoice;
    }

    if (ongoing) {
      return video ? ElementCallIntent.JoinExisting : ElementCallIntent.JoinExistingVoice;
    }
    return video ? ElementCallIntent.StartCall : ElementCallIntent.StartCallVoice;
  }

  static dmCall(intent: ElementCallIntent): boolean {
    return (
      intent === ElementCallIntent.JoinExistingDM ||
      intent === ElementCallIntent.JoinExistingDMVoice ||
      intent === ElementCallIntent.StartCallDM ||
      intent === ElementCallIntent.StartCallDMVoice
    );
  }

  static startingCall(intent: ElementCallIntent): boolean {
    return (
      intent === ElementCallIntent.StartCallDM ||
      intent === ElementCallIntent.StartCallDMVoice ||
      intent === ElementCallIntent.StartCall ||
      intent === ElementCallIntent.StartCallVoice
    );
  }

  static getWidget(
    mx: MatrixClient,
    room: Room,
    intent: ElementCallIntent,
    themeKind: ElementCallThemeKind,
    language: string
  ): Widget {
    const userId = mx.getSafeUserId();
    const deviceId = mx.getDeviceId() ?? '';
    const clientOrigin = window.location.origin;
    const widgetId = 'call-embed';

    const params = new URLSearchParams({
      widgetId,
      parentUrl: clientOrigin,
      baseUrl: mx.baseUrl,
      roomId: room.roomId,
      userId,
      deviceId,
      intent,

      skipLobby: 'true',
      confineToRoom: 'true',
      appPrompt: 'false',
      perParticipantE2EE: room.hasEncryptionStateEvent().toString(),
      // Element Call names its Chinese catalogs by script.
      // Other codes pass through so its supportedLngs and English fallback remain authoritative.
      lang: ELEMENT_CALL_LANGUAGE_CODES[language] ?? language,
      theme: themeKind,
      header: 'none',
    });

    if (!room.isCallRoom() && CallEmbed.startingCall(intent)) {
      params.append('sendNotificationType', CallEmbed.dmCall(intent) ? 'ring' : 'notification');
    }

    const widgetUrl = new URL(
      `${trimTrailingSlash(import.meta.env.BASE_URL)}/public/element-call/index.html`,
      window.location.origin
    );
    widgetUrl.search = params.toString();

    const options: IWidget = {
      id: widgetId,
      creatorUserId: userId,
      name: 'Call',
      type: 'm.call',
      url: widgetUrl.href,
      waitForIframeLoad: false,
      data: {},
    };

    const widget: Widget = new Widget(options);

    return widget;
  }

  static getIframe(url: string, title: string): HTMLIFrameElement {
    const iframe = document.createElement('iframe');

    iframe.title = title;
    iframe.setAttribute(
      'sandbox',
      'allow-forms allow-scripts allow-same-origin allow-popups allow-modals allow-downloads'
    );
    iframe.allow = 'microphone; camera; display-capture; autoplay; clipboard-write;';
    iframe.src = url;

    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.position = 'relative';
    iframe.style.zIndex = '1';
    iframe.style.backgroundColor = 'transparent';

    return iframe;
  }

  constructor(
    mx: MatrixClient,
    room: Room,
    widget: Widget,
    container: HTMLElement,
    iframeTitle: string,
    initialControlState?: CallControlState
  ) {
    const iframe = CallEmbed.getIframe(
      widget.getCompleteUrl({ currentUserId: mx.getSafeUserId() }),
      iframeTitle
    );
    container.append(iframe);

    const callWidgetDriver = new CallWidgetDriver(mx, room.roomId);
    const call: ClientWidgetApi = new ClientWidgetApi(widget, iframe, callWidgetDriver);
    restrictCallTransportToSameOrigin(call);

    this.mx = mx;
    this.call = call;
    this.room = room;
    this.startedAfterTs = room.getLiveTimeline().getEvents().at(-1)?.getTs();
    this.iframe = iframe;
    this.container = container;
    this.callWidgetDriver = callWidgetDriver;

    const controlState = initialControlState ?? new CallControlState(true, false, true);
    this.control = new CallControl(controlState, call, iframe);
    this.control.startObserving();
    iframe.onload = () => {
      this.control.startObserving();
    };

    let initialMediaEvent = true;
    this.disposables.push(
      this.listenAction<ElementMediaStateDetail>(ElementWidgetActions.DeviceMute, (evt) => {
        if (initialMediaEvent) {
          initialMediaEvent = false;
          this.control.applyState();
          return;
        }
        this.control.onMediaState(evt);
      })
    );

    this.start();
  }

  get roomId(): string {
    return this.room.roomId;
  }

  get document(): Document | undefined {
    return this.iframe.contentDocument ?? this.iframe.contentWindow?.document;
  }

  public setTheme(theme: ElementCallThemeKind) {
    return this.call.transport.send(WidgetApiToWidgetAction.ThemeChange, {
      name: theme,
    });
  }

  public setTitle(title: string): void {
    this.iframe.title = title;
  }

  public hangup() {
    return this.call.transport.send(ElementWidgetActions.HangupCall, {});
  }

  public onPreparing(callback: () => void) {
    return this.listenEvent('preparing', callback);
  }

  public onPreparingError(callback: (error: any) => void) {
    return this.listenEvent('error:preparing', callback);
  }

  public onReady(callback: () => void) {
    return this.listenEvent('ready', callback);
  }

  public onCapabilitiesNotified(callback: () => void) {
    return this.listenEvent('capabilitiesNotified', callback);
  }

  private start() {
    // Room widgets get locked to the room they were added in
    this.call.setViewedRoomId(this.roomId);
    this.disposables.push(
      this.listenAction(ElementWidgetActions.JoinCall, this.onCallJoined.bind(this))
    );

    // Populate the map of "read up to" events for this widget with the current event in every room.
    // This is a bit inefficient, but should be okay. We do this for all rooms in case the widget
    // requests timeline capabilities in other rooms down the road. It's just easier to manage here.
    this.mx.getRooms().forEach((room) => {
      // Timelines are most recent last
      const events = room.getLiveTimeline()?.getEvents() || [];
      const roomEvent = events[events.length - 1];
      if (!roomEvent) return; // force later code to think the room is fresh
      this.readUpToMap[room.roomId] = roomEvent.getId()!;
    });

    // Attach listeners for feeding events - the underlying widget classes handle permissions for us
    const onEvent = this.onEvent.bind(this);
    const onEventDecrypted = this.onEventDecrypted.bind(this);
    const onStateUpdate = this.onStateUpdate.bind(this);
    const onToDeviceEvent = this.onToDeviceEvent.bind(this);
    this.mx.on(ClientEvent.Event, onEvent);
    this.mx.on(MatrixEventEvent.Decrypted, onEventDecrypted);
    this.mx.on(RoomStateEvent.Events, onStateUpdate);
    this.mx.on(ClientEvent.ToDeviceEvent, onToDeviceEvent);
    this.disposables.push(
      () => this.mx.off(ClientEvent.Event, onEvent),
      () => this.mx.off(MatrixEventEvent.Decrypted, onEventDecrypted),
      () => this.mx.off(RoomStateEvent.Events, onStateUpdate),
      () => this.mx.off(ClientEvent.ToDeviceEvent, onToDeviceEvent)
    );
  }

  /**
   * Stops the widget messaging for if it is started. Skips stopping if it is an active
   * widget.
   * @param opts
   */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    const attempt = (step: string, run: () => void): void => {
      try {
        run();
      } catch (error) {
        logger.warn(`[call-embed] failed to dispose ${step}`, error);
      }
    };

    this.disposables.splice(0).forEach((disposable) => {
      attempt('listener', disposable);
    });
    attempt('widget driver', () => this.callWidgetDriver.dispose());
    attempt('widget transport', () => this.call.stop());
    attempt('iframe load handler', () => {
      this.iframe.onload = null;
    });
    attempt('iframe', () => this.container.removeChild(this.iframe));
    attempt('call controls', () => this.control.dispose());

    // Clear internal state
    this.readUpToMap = {};
    this.eventsToFeed = new WeakSet<MatrixEvent>();
  }

  private onCallJoined(): void {
    this.joined = true;
  }

  private onEvent(ev: MatrixEvent): void {
    this.mx.decryptEventIfNeeded(ev);
    this.feedEvent(ev);
  }

  private onEventDecrypted(ev: MatrixEvent): void {
    this.feedEvent(ev);
  }

  private onStateUpdate(ev: MatrixEvent): void {
    if (this.call === null) return;
    const raw = ev.getEffectiveEvent();
    this.call.feedStateUpdate(raw as IRoomEvent).catch((e) => {
      console.error('Error sending state update to widget: ', e);
    });
  }

  private async onToDeviceEvent(ev: MatrixEvent): Promise<void> {
    try {
      await this.mx.decryptEventIfNeeded(ev);
      if (this.disposed || ev.isDecryptionFailure()) return;
      await this.call?.feedToDevice(ev.getEffectiveEvent() as IRoomEvent, ev.isEncrypted());
    } catch (error) {
      if (!this.disposed) logger.error('Error sending to-device event to widget: ', error);
    }
  }

  /**
   * Determines whether the event has a relation to an unknown parent.
   */
  private relatesToUnknown(ev: MatrixEvent): boolean {
    // Replies to unknown events don't count
    if (!ev.relationEventId || ev.replyEventId) return false;
    const room = this.mx.getRoom(ev.getRoomId());
    return room === null || !room.findEventById(ev.relationEventId);
  }

  /**
   * Advances the "read up to" marker for a room to a certain event. No-ops if
   * the event is before the marker.
   * @returns Whether the "read up to" marker was advanced.
   */
  private advanceReadUpToMarker(ev: MatrixEvent): boolean {
    const evId = ev.getId();
    if (evId === undefined) return false;
    const roomId = ev.getRoomId();
    if (roomId === undefined) return false;
    const room = this.mx.getRoom(roomId);
    if (room === null) return false;

    const upToEventId = this.readUpToMap[ev.getRoomId()!];
    if (!upToEventId) {
      // There's no marker yet; start it at this event
      this.readUpToMap[roomId] = evId;
      return true;
    }

    // Small optimization for exact match (skip the search)
    if (upToEventId === evId) return false;

    // Timelines are most recent last, so reverse the order and limit ourselves to 100 events
    // to avoid overusing the CPU.
    const timeline = room.getLiveTimeline();
    const events = [...timeline.getEvents()].reverse().slice(0, 100);
    function isRelevantTimelineEvent(timelineEvent: MatrixEvent): boolean {
      return timelineEvent.getId() === upToEventId || timelineEvent.getId() === ev.getId();
    }
    const possibleMarkerEv = events.find(isRelevantTimelineEvent);
    if (possibleMarkerEv?.getId() === upToEventId) {
      // The event must be somewhere before the "read up to" marker
      return false;
    }
    if (possibleMarkerEv?.getId() === ev.getId()) {
      // The event is after the marker; advance it
      this.readUpToMap[roomId] = evId;
      return true;
    }

    // We can't say for sure whether the widget has seen the event; let's
    // just assume that it has
    return false;
  }

  /**
   * Determines whether the event comes from a room that we've been invited to
   * (in which case we likely don't have the full timeline).
   */
  private isFromInvite(ev: MatrixEvent): boolean {
    const room = this.mx.getRoom(ev.getRoomId());
    return room?.getMyMembership() === KnownMembership.Invite;
  }

  private feedEvent(ev: MatrixEvent): void {
    if (this.call === null) return;
    if (
      // If we had decided earlier to feed this event to the widget, but
      // it just wasn't ready, give it another try
      this.eventsToFeed.delete(ev) ||
      // Skip marker timeline check for events with relations to unknown parent because these
      // events are not added to the timeline here and will be ignored otherwise:
      // https://github.com/matrix-org/matrix-js-sdk/blob/d3dfcd924201d71b434af3d77343b5229b6ed75e/src/models/room.ts#L2207-L2213
      this.relatesToUnknown(ev) ||
      // Skip marker timeline check for rooms where membership is
      // 'invite', otherwise the membership event from the invitation room
      // will advance the marker and new state events will not be
      // forwarded to the widget.
      this.isFromInvite(ev) ||
      // Check whether this event would be before or after our "read up to" marker. If it's
      // before, or we can't decide, then we assume the widget will have already seen the event.
      // If the event is after, or we don't have a marker for the room,
      // then the marker will advance and we'll send it through.
      // This approach of "read up to" prevents widgets receiving decryption spam from startup or
      // receiving ancient events from backfill and such.
      this.advanceReadUpToMarker(ev)
    ) {
      // If the event is still being decrypted, remember that we want to
      // feed it to the widget (even if not strictly in the order given by
      // the timeline) and get back to it later
      if (ev.isBeingDecrypted() || ev.isDecryptionFailure()) {
        this.eventsToFeed.add(ev);
      } else {
        const raw = ev.getEffectiveEvent();
        this.call.feedEvent(raw as IRoomEvent).catch((e) => {
          console.error('Error sending event to widget: ', e);
        });
      }
    }
  }

  public listenAction<T>(type: string, callback: (event: CustomEvent<T>) => void) {
    return this.listenEvent(`action:${type}`, callback);
  }

  public listenEvent<T>(type: string, callback: (event: T) => void) {
    this.call.on(type, callback);
    return () => {
      this.call.off(type, callback);
    };
  }
}
