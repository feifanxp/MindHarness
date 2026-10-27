export const MODEL_REQUEST = 'io.mindroom.models.request';
export const MODEL_RESPONSE = 'io.mindroom.models.response';
export const MODEL_SELECTION = 'io.mindroom.model_selection';
export const MODEL_RESULT = 'io.mindroom.model_selection_result';
export const MODEL_TIMEOUT = 12000;

export type ModelCatalogEntry = {
  key: string;
  display_name: string;
  provider: string;
  id: string;
  icon_url?: string;
};
export type ModelInheritedEntry = { entity: string; model: string };
export type ModelSelection = { override: string | null; inherited: ModelInheritedEntry[] };
export type ModelCatalogResponse = {
  version: 1;
  request_id: string;
  room_id: string;
  thread_id?: string;
  capabilities: string[];
  agent_user_ids: string[];
  catalog_revision: string;
  models: ModelCatalogEntry[];
  selection: ModelSelection;
};
export type ModelSelectionResult = {
  version: 1;
  command_event_id: string;
  room_id: string;
  thread_id?: string;
  runtime_user_id: string;
  runtime_device_id: string;
  operation: 'set' | 'reset';
  model?: string;
  status: 'applied' | 'rejected';
  override?: string | null;
  error?: string;
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 1024): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;
const bounded = (v: unknown): v is Record<string, unknown> => {
  if (!record(v)) return false;
  try {
    return new TextEncoder().encode(JSON.stringify(v)).length <= 65536;
  } catch {
    return false;
  }
};
const scope = (v: Record<string, unknown>): boolean =>
  v.version === 1 && str(v.room_id) && (v.thread_id === undefined || str(v.thread_id));
export const parseModelCatalogResponse = (value: unknown): ModelCatalogResponse | undefined => {
  if (
    !bounded(value) ||
    !scope(value) ||
    !str(value.request_id, 128) ||
    !str(value.catalog_revision) ||
    !Array.isArray(value.capabilities) ||
    !value.capabilities.every((v) => str(v)) ||
    !Array.isArray(value.agent_user_ids) ||
    !value.agent_user_ids.every((v) => str(v)) ||
    !Array.isArray(value.models) ||
    value.models.length > 256 ||
    !record(value.selection)
  )
    return undefined;
  const selection = value.selection;
  if (
    !(selection.override === null || str(selection.override)) ||
    !Array.isArray(selection.inherited) ||
    !selection.inherited.every((v) => record(v) && str(v.entity) && str(v.model))
  )
    return undefined;
  const models: ModelCatalogEntry[] = [];
  const keys = new Set<string>();
  for (const m of value.models) {
    if (
      !record(m) ||
      !str(m.key) ||
      keys.has(m.key) ||
      !str(m.provider) ||
      !str(m.id) ||
      (m.display_name !== undefined && !str(m.display_name)) ||
      (m.icon_url !== undefined &&
        !(str(m.icon_url) && /^mxc:\/\/[^/\s?#]+\/[^/\s?#]+$/.test(m.icon_url)))
    )
      return undefined;
    keys.add(m.key);
    models.push({
      key: m.key,
      display_name: m.display_name ?? m.key,
      provider: m.provider,
      id: m.id,
      ...(m.icon_url === undefined ? {} : { icon_url: m.icon_url }),
    } as ModelCatalogEntry);
  }
  if (typeof selection.override === 'string' && !keys.has(selection.override)) return undefined;
  return {
    version: 1,
    request_id: value.request_id,
    room_id: value.room_id as string,
    ...(value.thread_id === undefined ? {} : { thread_id: value.thread_id as string }),
    capabilities: value.capabilities as string[],
    agent_user_ids: value.agent_user_ids as string[],
    catalog_revision: value.catalog_revision,
    models,
    selection: selection as ModelSelection,
  };
};
export const parseModelSelectionResult = (value: unknown): ModelSelectionResult | undefined => {
  if (
    !bounded(value) ||
    !scope(value) ||
    !str(value.command_event_id) ||
    !str(value.runtime_user_id) ||
    !str(value.runtime_device_id, 255) ||
    !['set', 'reset'].includes(value.operation as string) ||
    (value.operation === 'set' ? !str(value.model) : value.model !== undefined) ||
    !['applied', 'rejected'].includes(value.status as string) ||
    (value.error !== undefined && !str(value.error))
  )
    return undefined;
  if (value.status === 'applied') {
    if (value.override !== (value.operation === 'set' ? value.model : null)) return undefined;
  } else if (value.override !== undefined) return undefined;
  return value as ModelSelectionResult;
};
