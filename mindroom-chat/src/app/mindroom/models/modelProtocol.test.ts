import { describe, expect, it } from 'vitest';
import { parseModelCatalogResponse, parseModelSelectionResult } from './modelProtocol';

const catalog = {
  version: 1,
  request_id: 'r',
  room_id: '!room:test',
  thread_id: '$root',
  capabilities: ['model_selection'],
  agent_user_ids: ['@mindroom_helper:test'],
  catalog_revision: 'revision',
  models: [
    { key: 'fast', display_name: 'Same', provider: 'openai', id: 'model' },
    { key: 'reset', display_name: 'Same', provider: 'openai', id: 'model' },
  ],
  selection: { override: null, inherited: [{ entity: 'helper', model: 'fast' }] },
};

describe('model catalog wire validation', () => {
  it('keeps stable keys with duplicate labels', () => {
    expect(parseModelCatalogResponse(catalog)?.models.map((m) => m.key)).toEqual(['fast', 'reset']);
  });
  it.each([
    { version: 2 },
    { request_id: '' },
    { thread_id: null },
    { models: Array(257).fill(catalog.models[0]) },
    { catalog_revision: 'x'.repeat(65536) },
    { selection: { inherited: [] } },
    { models: [{ ...catalog.models[0], icon_url: 'https://example.org/logo' }] },
    { models: [catalog.models[0], catalog.models[0]] },
  ])('rejects malformed response %j', (change) => {
    expect(parseModelCatalogResponse({ ...catalog, ...change })).toBeUndefined();
  });
  it('falls back to key and accepts Matrix media', () => {
    expect(
      parseModelCatalogResponse({
        ...catalog,
        models: [{ key: 'fast', provider: 'openai', id: 'm', icon_url: 'mxc://test/image' }],
      })?.models[0]
    ).toEqual({
      key: 'fast',
      display_name: 'fast',
      provider: 'openai',
      id: 'm',
      icon_url: 'mxc://test/image',
    });
  });
});

describe('selection result wire validation', () => {
  const result = {
    version: 1,
    command_event_id: '$command',
    room_id: '!room:test',
    thread_id: '$root',
    runtime_user_id: '@mindroom_router:test',
    runtime_device_id: 'DEVICE',
    operation: 'set',
    model: 'reset',
    status: 'applied',
    override: 'reset',
  };
  it('distinguishes set reset from reset operation', () => {
    expect(parseModelSelectionResult(result)?.override).toBe('reset');
    expect(parseModelSelectionResult({ ...result, operation: 'reset' })).toBeUndefined();
  });
  it.each([{ runtime_device_id: '' }, { override: null }, { status: 'rejected' }, { version: 2 }])(
    'rejects inconsistent result %j',
    (change) => {
      expect(parseModelSelectionResult({ ...result, ...change })).toBeUndefined();
    }
  );
});
