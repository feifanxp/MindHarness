import {
  ClientEvent,
  MatrixClient,
  MatrixEvent,
  MatrixEventEvent,
  Room,
  RoomMember,
  RoomMemberEvent,
  SyncState,
} from 'matrix-js-sdk';
import type { ReceivedToDeviceMessage } from 'matrix-js-sdk/lib/sync-accumulator';
import type { RoomMessageEventContent } from 'matrix-js-sdk/lib/@types/events';
import { CryptoEvent } from 'matrix-js-sdk/lib/crypto-api';
import { getMessageRelation } from '../threads/composeMessageRelation';
import {
  ModelCatalogEntry,
  ModelCatalogResponse,
  ModelInheritedEntry,
  ModelSelectionResult,
  MODEL_RESPONSE,
  MODEL_RESULT,
  MODEL_SELECTION,
  MODEL_TIMEOUT,
  parseModelCatalogResponse,
  parseModelSelectionResult,
} from './modelProtocol';
import {
  ModelRuntime,
  hasJoinedModelAgent,
  isCurrentModelRuntime,
  joinedModelCandidates,
  signedModelDevices,
} from './modelDeviceTrust';
import { sendModelRequest } from './modelTransport';

export type ModelPickerSnapshot = {
  eligible: boolean;
  runtimes: ModelRuntime[];
  runtime?: ModelRuntime;
  models: ModelCatalogEntry[];
  override: string | null;
  inherited: ModelInheritedEntry[];
  loading: boolean;
  pending: boolean;
  canMutate: boolean;
  error?: string;
};
type Catalog = { runtime: ModelRuntime; response: ModelCatalogResponse };
type RoomCatalog = { runtime: ModelRuntime; models: ModelCatalogEntry[]; agentUserIds: string[] };
type Scope = {
  room: Room;
  threadId?: string;
  snapshot: ModelPickerSnapshot;
  listeners: Set<() => void>;
  catalogs: Map<string, Catalog>;
  generation: number;
  needsRefresh: boolean;
  chosenRuntimeId?: string;
  refreshScheduled?: boolean;
  query?: Query;
  command?: Command;
  send?: Command;
};
type Query = {
  id: string;
  scope: Scope;
  generation: number;
  devices: ModelRuntime[];
  hydrating: boolean;
  replies: Map<string, Catalog>;
  abort: AbortController;
  timer: ReturnType<typeof setTimeout>;
};
type Command = {
  scope: Scope;
  runtime: ModelRuntime;
  operation: 'set' | 'reset';
  model?: string;
  eventId?: string;
  generation: number;
  early: ModelSelectionResult[];
  acknowledged?: boolean;
  timer: ReturnType<typeof setTimeout>;
};
const emptySnapshot = (): ModelPickerSnapshot => ({
  eligible: false,
  runtimes: [],
  models: [],
  override: null,
  inherited: [],
  loading: false,
  pending: false,
  canMutate: false,
});
const scopeKey = (room: Room, threadId?: string): string => JSON.stringify([room.roomId, threadId]);
const controllers = new WeakMap<MatrixClient, ModelController>();

/** One listener owner per client; composer subscriptions only select a scope. */
export class ModelController {
  private readonly scopes = new Map<string, Scope>();

  private readonly roomCatalogs = new Map<string, RoomCatalog[]>();

  private readonly queries = new Map<string, Query>();

  private readonly userId: string | null;

  private disposed = false;

  private started = false;

  private owners = 0;

  constructor(private readonly mx: MatrixClient) {
    this.userId = mx.getUserId();
  }

  /** Restart is explicit; snapshot reads and actions never replace a stopped owner. */
  retain = (): (() => void) => {
    this.owners += 1;
    this.start();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.owners -= 1;
      if (this.owners === 0) this.dispose();
    };
  };

  private start(): void {
    if (
      (this.started && !this.disposed) ||
      this.mx.getSyncState() === SyncState.Stopped ||
      this.mx.getUserId() !== this.userId
    )
      return;
    this.started = true;
    this.disposed = false;
    const mx = this.mx;
    mx.on(ClientEvent.ReceivedToDeviceMessage, this.onResponse);
    mx.on(ClientEvent.Event, this.onEvent);
    mx.on(MatrixEventEvent.Decrypted, this.onEvent);
    mx.on(RoomMemberEvent.Membership, this.onMembership);
    mx.on(CryptoEvent.DevicesUpdated, this.onDevices);
    mx.on(ClientEvent.Sync, this.onSync);
    this.scopes.forEach((scope) => {
      if (scope.listeners.size) this.refresh(scope.room, scope.threadId);
    });
  }

  private active(): boolean {
    return this.started && !this.disposed && this.mx.getUserId() === this.userId;
  }

  private scope(room: Room, threadId?: string): Scope {
    const key = scopeKey(room, threadId);
    let scope = this.scopes.get(key);
    if (!scope) {
      // Keep inactive scope caches bounded without evicting subscriptions or pending commands.
      if (this.scopes.size >= 64) {
        const stale = [...this.scopes.entries()].find(
          ([, s]) => !s.listeners.size && !s.command && !s.send
        );
        if (stale) {
          this.cancelQuery(stale[1]);
          this.scopes.delete(stale[0]);
        }
      }
      const cached = threadId
        ? (this.roomCatalogs.get(room.roomId) ?? []).filter((catalog) =>
            hasJoinedModelAgent(this.mx, room, catalog.runtime, catalog.agentUserIds)
          )
        : [];
      scope = {
        room,
        threadId,
        snapshot: {
          ...emptySnapshot(),
          eligible: cached.length > 0,
          runtimes: cached.map((catalog) => catalog.runtime),
          models: cached.length === 1 ? cached[0].models : [],
        },
        listeners: new Set(),
        catalogs: new Map(),
        generation: 0,
        needsRefresh: false,
      };
      this.scopes.set(key, scope);
    }
    return scope;
  }

  getSnapshot = (room: Room, threadId?: string): ModelPickerSnapshot =>
    this.scope(room, threadId).snapshot;

  private publish(scope: Scope, patch: Partial<ModelPickerSnapshot>): void {
    scope.snapshot = { ...scope.snapshot, ...patch };
    scope.snapshot.canMutate = this.canMutate(scope);
    scope.listeners.forEach((listener) => listener());
  }

  subscribe = (room: Room, threadId: string | undefined, listener: () => void): (() => void) => {
    if (!this.started && !this.disposed) this.start();
    const scope = this.scope(room, threadId);
    scope.listeners.add(listener);
    if (scope.listeners.size === 1 && !scope.command) this.refresh(room, threadId);
    return () => {
      scope.listeners.delete(listener);
      if (!scope.listeners.size) {
        this.cancelQuery(scope);
        this.publish(scope, { loading: false });
      }
    };
  };

  private cancelQuery(scope: Scope): void {
    const query = scope.query;
    if (!query) return;
    query.abort.abort();
    clearTimeout(query.timer);
    this.queries.delete(query.id);
    scope.query = undefined;
  }

  private currentQuery(query: Query): boolean {
    return (
      this.active() &&
      this.queries.get(query.id) === query &&
      query.scope.generation === query.generation &&
      !query.abort.signal.aborted
    );
  }

  refresh = (room: Room, threadId?: string): void => {
    const scope = this.scope(room, threadId);
    if (
      !this.active() ||
      !threadId ||
      threadId.length > 1024 ||
      room.roomId.length > 1024 ||
      scope.command ||
      scope.query
    )
      return;
    if (this.queries.size >= 8) {
      this.publish(scope, { error: 'Model discovery is busy. Try refresh.' });
      return;
    }
    scope.generation += 1;
    const query: Query = {
      id: globalThis.crypto.randomUUID(),
      scope,
      generation: scope.generation,
      devices: [],
      hydrating: !room.membersLoaded(),
      replies: new Map(),
      abort: new AbortController(),
      timer: setTimeout(() => this.finishQuery(query), MODEL_TIMEOUT),
    };
    scope.query = query;
    this.queries.set(query.id, query);
    this.publish(scope, { loading: true });
    void this.probe(query);
  };

  private async probe(query: Query): Promise<void> {
    try {
      if (query.hydrating) await query.scope.room.loadMembersIfNeeded();
      if (!this.currentQuery(query)) return;
      query.hydrating = false;
      const candidates = joinedModelCandidates(this.mx, query.scope.room);
      if (!candidates.length) {
        this.invalidate(query.scope);
        return;
      }
      const devices = await signedModelDevices(this.mx, candidates);
      if (!this.currentQuery(query)) return;
      query.devices = devices;
      if (!devices.length) {
        this.finishQuery(query);
        return;
      }
      await sendModelRequest(
        this.mx,
        devices,
        {
          version: 1,
          request_id: query.id,
          room_id: query.scope.room.roomId,
          ...(query.scope.threadId ? { thread_id: query.scope.threadId } : {}),
        },
        query.abort.signal,
        (runtimeId) => query.replies.has(runtimeId)
      );
    } catch {
      if (this.currentQuery(query)) this.finishQuery(query);
    }
  }

  private finishQuery(query: Query): void {
    if (!this.currentQuery(query)) return;
    const { scope } = query;
    this.cancelQuery(scope);
    if (!query.replies.size) {
      this.publish(scope, {
        loading: false,
        ...(scope.snapshot.eligible || scope.needsRefresh
          ? { error: 'Model discovery unavailable. Refresh or use !model.' }
          : {}),
      });
      return;
    }
    scope.catalogs = query.replies;
    if (this.roomCatalogs.size >= 64 && !this.roomCatalogs.has(scope.room.roomId)) {
      this.roomCatalogs.delete(this.roomCatalogs.keys().next().value!);
    }
    this.roomCatalogs.set(
      scope.room.roomId,
      [...query.replies.values()].map((catalog) => ({
        runtime: catalog.runtime,
        models: catalog.response.models,
        agentUserIds: catalog.response.agent_user_ids,
      }))
    );
    scope.needsRefresh = !!scope.send;
    const runtimes = [...scope.catalogs.values()].map((c) => c.runtime);
    const runtime =
      runtimes.find((r) => r.id === scope.chosenRuntimeId) ??
      (runtimes.length === 1 ? runtimes[0] : undefined);
    this.publish(scope, {
      eligible: true,
      runtimes,
      runtime,
      loading: false,
      pending: !!scope.send,
      error: scope.send ? scope.snapshot.error : undefined,
    });
    this.showRuntime(scope, runtime);
  }

  private onResponse = (payload: ReceivedToDeviceMessage): void => {
    void this.receiveResponse(payload).catch(() => undefined);
  };

  private async receiveResponse({
    message,
    encryptionInfo,
  }: ReceivedToDeviceMessage): Promise<void> {
    if (
      !this.active() ||
      message.type !== MODEL_RESPONSE ||
      !encryptionInfo ||
      encryptionInfo.sender !== message.sender
    )
      return;
    const response = parseModelCatalogResponse(message.content);
    if (!response || !response.capabilities.includes('model_selection')) return;
    const query = this.queries.get(response.request_id);
    if (
      !query ||
      !this.currentQuery(query) ||
      response.room_id !== query.scope.room.roomId ||
      response.thread_id !== query.scope.threadId
    )
      return;
    const runtime = query.devices.find(
      (d) => d.userId === message.sender && d.curveKey === encryptionInfo.senderCurve25519KeyBase64
    );
    if (
      !runtime ||
      !hasJoinedModelAgent(this.mx, query.scope.room, runtime, response.agent_user_ids) ||
      !(await isCurrentModelRuntime(this.mx, runtime)) ||
      !this.currentQuery(query) ||
      !hasJoinedModelAgent(this.mx, query.scope.room, runtime, response.agent_user_ids)
    )
      return;
    query.replies.set(runtime.id, { runtime, response });
    // Keep collecting: another signed device may represent a distinct runtime.
  }

  chooseRuntime = (room: Room, threadId: string | undefined, runtimeId: string): void => {
    const scope = this.scope(room, threadId);
    if (!this.active() || scope.command) return;
    const catalog = scope.catalogs.get(runtimeId);
    if (!catalog) return;
    scope.chosenRuntimeId = runtimeId;
    this.showRuntime(scope, catalog.runtime);
  };

  private showRuntime(scope: Scope, runtime?: ModelRuntime): void {
    const catalog = runtime && scope.catalogs.get(runtime.id);
    this.publish(scope, {
      runtime,
      models: catalog ? catalog.response.models : [],
      override: catalog ? catalog.response.selection.override : null,
      inherited: catalog ? catalog.response.selection.inherited : [],
    });
  }

  selectModel = (room: Room, threadId: string | undefined, model: string): void => {
    this.mutate(this.scope(room, threadId), 'set', model);
  };

  resetToRoomDefault = (room: Room, threadId?: string): void => {
    this.mutate(this.scope(room, threadId), 'reset');
  };

  private canMutate(scope: Scope): boolean {
    const { runtime } = scope.snapshot;
    const catalog = runtime && scope.catalogs.get(runtime.id);
    return !!(
      this.active() &&
      scope.threadId &&
      catalog &&
      runtime &&
      !scope.command &&
      !scope.send &&
      !scope.needsRefresh &&
      hasJoinedModelAgent(this.mx, scope.room, runtime, catalog.response.agent_user_ids)
    );
  }

  private mutate(scope: Scope, operation: 'set' | 'reset', model?: string): void {
    if (
      !this.canMutate(scope) ||
      (operation === 'set' && !scope.snapshot.models.some((m) => m.key === model))
    )
      return;
    const runtime = scope.snapshot.runtime!;
    this.cancelQuery(scope);
    scope.generation += 1;
    const command: Command = {
      scope,
      runtime,
      operation,
      model,
      generation: scope.generation,
      early: [],
      timer: setTimeout(() => this.uncertain(command), MODEL_TIMEOUT),
    };
    scope.command = command;
    scope.send = command;
    this.publish(scope, { pending: true, loading: false, error: undefined });
    void this.sendCommand(command);
  }

  private currentCommand(command: Command): boolean {
    return (
      this.active() &&
      command.scope.command === command &&
      command.scope.generation === command.generation
    );
  }

  private async sendCommand(command: Command): Promise<void> {
    const { scope, runtime, operation, model } = command;
    try {
      if (!(await isCurrentModelRuntime(this.mx, runtime))) {
        if (this.currentCommand(command)) this.invalidate(scope);
        return;
      }
      if (!this.currentCommand(command)) return;
      const content = {
        msgtype: 'm.text',
        body: '!model ' + (operation === 'reset' ? 'reset' : model),
        'm.relates_to': getMessageRelation(undefined, undefined, scope.threadId),
        [MODEL_SELECTION]: {
          version: 1,
          runtime_user_id: runtime.userId,
          runtime_device_id: runtime.deviceId,
          operation,
          ...(operation === 'set' ? { model } : {}),
        },
      } as RoomMessageEventContent;
      // The client scheduler already retries a dropped connection within its window; sending
      // the command again afterwards could change the model long after it was chosen.
      const result = await this.mx.sendMessage(scope.room.roomId, scope.threadId!, content);
      if (!this.currentCommand(command)) return;
      command.eventId = result.event_id;
      command.early.forEach((ack) => this.applyResult(command, ack));
      command.early = [];
    } catch {
      if (this.currentCommand(command)) this.uncertain(command);
    } finally {
      this.settleSend(command);
    }
  }

  private settleSend(command: Command): void {
    const { scope } = command;
    if (scope.send !== command) return;
    scope.send = undefined;
    if (command.acknowledged) {
      this.publish(scope, { pending: false });
      return;
    }
    if (this.currentCommand(command)) return;
    // A query completed before settlement can precede the delayed server mutation.
    // Keep the barrier until a new query, started after settlement, confirms selection.
    scope.needsRefresh = true;
    this.cancelQuery(scope);
    scope.generation += 1;
    this.publish(scope, { pending: this.active() });
    if (this.active()) this.refresh(scope.room, scope.threadId);
  }

  private onEvent = (event: MatrixEvent): void => {
    void this.receiveResult(event).catch(() => undefined);
  };

  private async receiveResult(event: MatrixEvent): Promise<void> {
    if (!this.active() || event.getType() !== 'm.room.message' || event.isRedacted()) return;
    const result = parseModelSelectionResult(event.getContent()[MODEL_RESULT]);
    if (
      !result ||
      !result.thread_id ||
      event.getRoomId() !== result.room_id ||
      event.getRelation()?.rel_type !== 'm.thread' ||
      event.getRelation()?.event_id !== result.thread_id
    )
      return;
    const scope = this.scopes.get(JSON.stringify([result.room_id, result.thread_id]));
    const command = scope?.command;
    if (
      !command ||
      !this.currentCommand(command) ||
      event.getSender() !== command.runtime.userId ||
      result.runtime_user_id !== command.runtime.userId ||
      result.runtime_device_id !== command.runtime.deviceId ||
      result.operation !== command.operation ||
      result.model !== command.model
    )
      return;
    const catalog = scope?.catalogs.get(command.runtime.id);
    if (
      !scope ||
      !catalog ||
      !hasJoinedModelAgent(this.mx, scope.room, command.runtime, catalog.response.agent_user_ids)
    )
      return;
    const encryptedRoom = !!scope.room.currentState.getStateEvents('m.room.encryption', '');
    if (encryptedRoom || event.isEncrypted()) {
      if (
        !event.isEncrypted() ||
        event.getSenderKey() !== command.runtime.curveKey ||
        !(await isCurrentModelRuntime(this.mx, command.runtime))
      )
        return;
    }
    if (!this.currentCommand(command)) return;
    if (!command.eventId) {
      if (command.early.length < 16) command.early.push(result);
      return;
    }
    this.applyResult(command, result);
  }

  private applyResult(command: Command, result: ModelSelectionResult): void {
    if (!this.currentCommand(command) || command.eventId !== result.command_event_id) return;
    const { scope } = command;
    clearTimeout(command.timer);
    command.acknowledged = true;
    scope.command = undefined;
    if (result.status === 'applied') {
      const override = result.override ?? null;
      const catalog = scope.catalogs.get(command.runtime.id);
      if (catalog)
        catalog.response = {
          ...catalog.response,
          selection: { ...catalog.response.selection, override },
        };
      this.publish(scope, { pending: !!scope.send, override, error: undefined });
    } else {
      this.publish(scope, {
        pending: !!scope.send,
        error: result.error ?? 'Model selection rejected. Refresh or use !model.',
      });
    }
  }

  private uncertain(command: Command): void {
    if (!this.currentCommand(command)) return;
    const { scope } = command;
    clearTimeout(command.timer);
    scope.command = undefined;
    scope.needsRefresh = true;
    this.publish(scope, {
      pending: !!scope.send,
      error: 'Model selection unconfirmed. Refresh before trying again.',
    });
    this.refresh(scope.room, scope.threadId);
  }

  private invalidate(scope: Scope): void {
    this.cancelQuery(scope);
    scope.generation += 1;
    if (scope.command) clearTimeout(scope.command.timer);
    scope.command = undefined;
    scope.catalogs.clear();
    this.roomCatalogs.delete(scope.room.roomId);
    scope.needsRefresh = true;
    scope.snapshot = { ...emptySnapshot(), pending: !!scope.send };
    scope.listeners.forEach((listener) => listener());
  }

  private onMembership = (_event: MatrixEvent, member: RoomMember): void => {
    this.roomCatalogs.delete(member.roomId);
    this.scopes.forEach((scope) => {
      if (scope.room.roomId !== member.roomId) return;
      if (scope.query?.hydrating && !scope.catalogs.size) return;
      this.invalidateAndRefresh(scope);
    });
  };

  private onDevices = (users: string[]): void => {
    this.roomCatalogs.forEach((catalogs, roomId) => {
      if (catalogs.some((catalog) => users.includes(catalog.runtime.userId))) {
        this.roomCatalogs.delete(roomId);
      }
    });
    this.scopes.forEach((scope) => {
      const known = [...scope.catalogs.values()]
        .map((c) => c.runtime)
        .concat(scope.query?.devices ?? [], scope.snapshot.runtimes);
      if (known.some((d) => users.includes(d.userId))) this.invalidateAndRefresh(scope);
    });
  };

  private invalidateAndRefresh(scope: Scope): void {
    this.invalidate(scope);
    if (scope.refreshScheduled || !scope.listeners.size) return;
    scope.refreshScheduled = true;
    void Promise.resolve().then(() => {
      scope.refreshScheduled = false;
      if (this.active() && scope.listeners.size) this.refresh(scope.room, scope.threadId);
    });
  }

  private onSync = (state: SyncState): void => {
    if (state === SyncState.Stopped) this.dispose();
  };

  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.scopes.forEach((scope) => this.invalidate(scope));
    this.roomCatalogs.clear();
    this.mx.removeListener(ClientEvent.ReceivedToDeviceMessage, this.onResponse);
    this.mx.removeListener(ClientEvent.Event, this.onEvent);
    this.mx.removeListener(MatrixEventEvent.Decrypted, this.onEvent);
    this.mx.removeListener(RoomMemberEvent.Membership, this.onMembership);
    this.mx.removeListener(CryptoEvent.DevicesUpdated, this.onDevices);
    this.mx.removeListener(ClientEvent.Sync, this.onSync);
  };
}

export const getModelController = (mx: MatrixClient): ModelController => {
  let controller = controllers.get(mx);
  if (!controller) {
    controller = new ModelController(mx);
    controllers.set(mx, controller);
  }
  return controller;
};
export const disposeModelController = (mx: MatrixClient): void => controllers.get(mx)?.dispose();
