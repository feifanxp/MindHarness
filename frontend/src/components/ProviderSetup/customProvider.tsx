import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { API_BASE_URL, fetchJSON } from "@/lib/api";
import { useConfigStore } from "@/store/configStore";
import type { ModelConfig } from "@/types/config";

type Protocol = "chat_completions" | "responses" | "anthropic";
export type CustomProvider = {
  name: string;
  baseUrl: string;
  protocol: Protocol;
};
export const EMPTY_CUSTOM_PROVIDER: CustomProvider = {
  name: "",
  baseUrl: "",
  protocol: "chat_completions",
};
export type Catalog = { models: ModelConfig[]; truncated: boolean };
const serviceFor = (name: string) => `custom-provider:${name.trim()}:key`;

export function savedCustomProviders(
  models: Record<string, ModelConfig>,
): CustomProvider[] {
  const providers = new Map<string, CustomProvider>();
  for (const model of Object.values(models)) {
    const match = model.credentials_service?.match(
      /^custom-provider:([A-Za-z0-9_-]+):key$/,
    );
    if (!match) continue;
    const protocol =
      model.provider === "anthropic"
        ? "anthropic"
        : model.api === "responses"
          ? "responses"
          : "chat_completions";
    const kwargs = model.extra_kwargs ?? {};
    const baseUrl =
      protocol === "anthropic"
        ? (kwargs.client_params as { base_url?: string } | undefined)?.base_url
        : kwargs.base_url;
    if (typeof baseUrl === "string")
      providers.set(match[1], { name: match[1], baseUrl, protocol });
  }
  return [...providers.values()];
}

export async function discoverCustomModels(
  value: CustomProvider,
  apiKey: string,
): Promise<Catalog> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value.name.trim()))
    throw new Error("提供方名称只能包含字母、数字、下划线和连字符。");
  if (!value.baseUrl.trim()) throw new Error("请填写 API 地址。");
  return fetchJSON<Catalog>(
    `${API_BASE_URL}/api/provider-setup/discover-models`,
    {
      method: "POST",
      body: JSON.stringify({
        name: value.name.trim(),
        base_url: value.baseUrl.trim(),
        protocol: value.protocol,
        api_key: apiKey.trim(),
      }),
    },
  );
}

export async function connectCustomProvider(
  value: CustomProvider,
  apiKey: string,
  selected: ModelConfig[],
): Promise<number> {
  const store = useConfigStore.getState();
  const initialConfig = store.config;
  if (!initialConfig) throw new Error("请等待配置加载完成。");
  if (store.isDirty)
    throw new Error("请先保存或撤销管理后台中尚未保存的配置。");
  const service = serviceFor(value.name);
  const models = { ...initialConfig.models };
  let count = 0;
  for (const model of selected) {
    if (model.credentials_service !== service)
      throw new Error("连接信息已变化，请重新获取模型。");
    if (
      Object.values(models).some(
        (existing) =>
          existing.credentials_service === service && existing.id === model.id,
      )
    )
      continue;
    const stem =
      `${value.name.trim()}-${model.id.replace(/[^A-Za-z0-9_-]/g, "-")}`.slice(
        0,
        58,
      );
    let name = stem;
    let suffix = 2;
    while (models[name]) name = `${stem}-${suffix++}`;
    models[name] = model;
    count++;
  }
  if (
    !count &&
    !Object.values(models).some(
      (model) => model.credentials_service === service,
    )
  )
    throw new Error("请至少选择一个模型。");
  if (apiKey.trim()) {
    await fetchJSON(
      `${API_BASE_URL}/api/credentials/${encodeURIComponent(service)}/api-key`,
      {
        method: "POST",
        body: JSON.stringify({
          service,
          api_key: apiKey.trim(),
          key_name: "api_key",
        }),
      },
    );
  }
  const current = useConfigStore.getState();
  if (current.config !== initialConfig || current.isDirty)
    throw new Error(
      "配置在保存期间发生变化，请重新同步。若填写了新 Key，它已保存。",
    );
  if (count) {
    current.updateConfigValue(["models"], models);
    const result = await useConfigStore.getState().saveConfig();
    if (result.status !== "saved")
      throw new Error(
        "凭据已保存，但模型配置未保存成功。请检查管理后台的待保存配置并重试。",
      );
  }
  return count;
}

export function CustomProviderSetup({
  disabled,
  onBusyChange,
  onComplete,
}: {
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onComplete: (count: number) => void;
}) {
  const models = useConfigStore((state) => state.config?.models);
  const providers = savedCustomProviders(models ?? {});
  const [savedName, setSavedName] = useState("");
  const [value, setValue] = useState(EMPTY_CUSTOM_PROVIDER);
  const [apiKey, setApiKey] = useState("");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const existing = new Set(
    Object.values(models ?? {})
      .filter((model) => model.credentials_service === serviceFor(value.name))
      .map((model) => model.id),
  );
  const visible =
    catalog?.models.filter((model) =>
      `${model.id} ${model.display_name ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) ?? [];
  const invalidate = () => {
    setCatalog(null);
    setSelected([]);
    setError(null);
  };
  const update = (next: CustomProvider) => {
    setValue(next);
    invalidate();
  };
  const sync = async () => {
    onBusyChange(true);
    invalidate();
    try {
      setCatalog(await discoverCustomModels(value, apiKey));
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取模型失败。");
    } finally {
      onBusyChange(false);
    }
  };
  const save = async () => {
    if (!catalog) return;
    onBusyChange(true);
    setError(null);
    try {
      const count = await connectCustomProvider(
        value,
        apiKey,
        catalog.models.filter((model) => selected.includes(model.id)),
      );
      setApiKey("");
      onComplete(count);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败。");
    } finally {
      onBusyChange(false);
    }
  };
  return (
    <fieldset disabled={disabled} className="mt-4 grid min-w-0 gap-3">
      <legend className="sr-only">第三方 API 提供方</legend>
      {providers.length > 0 && (
        <div className="space-y-1">
          <Label htmlFor="custom-saved-provider">提供方</Label>
          <select
            id="custom-saved-provider"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={savedName}
            onChange={(e) => {
              setSavedName(e.target.value);
              setApiKey("");
              setSearch("");
              update(
                providers.find((p) => p.name === e.target.value) ??
                  EMPTY_CUSTOM_PROVIDER,
              );
            }}
          >
            <option value="">＋ 新增提供方</option>
            {providers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="custom-provider-name">提供方名称</Label>
        <Input
          id="custom-provider-name"
          value={value.name}
          maxLength={64}
          placeholder="my-provider"
          readOnly={!!savedName}
          onChange={(e) => update({ ...value, name: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="custom-protocol">调用方式</Label>
        <select
          id="custom-protocol"
          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          value={value.protocol}
          disabled={disabled || !!savedName}
          onChange={(e) =>
            update({ ...value, protocol: e.target.value as Protocol })
          }
        >
          <option value="chat_completions">OpenAI Chat Completions</option>
          <option value="responses">OpenAI Responses</option>
          <option value="anthropic">Anthropic Messages</option>
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="custom-base-url">API 地址（Base URL）</Label>
        <Input
          id="custom-base-url"
          type="url"
          maxLength={2048}
          spellCheck={false}
          value={value.baseUrl}
          readOnly={!!savedName}
          placeholder="https://api.example.com/v1"
          onChange={(e) => update({ ...value, baseUrl: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          填写 API 根地址，保留所需的 /v1 前缀。Anthropic 会自动处理 /v1。
        </p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="custom-api-key">API Key</Label>
        <Input
          id="custom-api-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          placeholder={
            savedName
              ? "留空使用已保存的 Key；填写新值可更新"
              : "输入第三方提供的 API Key"
          }
          onChange={(e) => {
            setApiKey(e.target.value);
            invalidate();
          }}
        />
        <p className="text-xs text-muted-foreground">
          此提供方下的所有模型共享一个 Key。
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={
          disabled ||
          !value.name.trim() ||
          !value.baseUrl.trim() ||
          (!savedName && !apiKey.trim())
        }
        onClick={() => void sync()}
      >
        {disabled ? "处理中…" : "获取 / 同步模型"}
      </Button>
      {catalog && (
        <section
          aria-label="可用模型"
          className="min-w-0 space-y-3 rounded-lg border p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <strong>可用模型（{catalog.models.length}）</strong>
            <span role="status">已选 {selected.length} 个</span>
          </div>
          <Label htmlFor="custom-model-search" className="sr-only">
            搜索模型
          </Label>
          <Input
            id="custom-model-search"
            type="search"
            placeholder="搜索模型名称或 ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setSelected([
                  ...new Set([
                    ...selected,
                    ...visible
                      .filter((m) => !existing.has(m.id))
                      .map((m) => m.id),
                  ]),
                ])
              }
            >
              全选搜索结果
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setSelected([])}
            >
              清空选择
            </Button>
          </div>
          <div className="max-h-60 overflow-y-auto">
            {visible.map((model) => (
              <label
                key={model.id}
                className="flex cursor-pointer items-start gap-3 rounded px-2 py-2 hover:bg-muted"
              >
                <input
                  type="checkbox"
                  className="mt-1 shrink-0"
                  aria-label={model.id}
                  disabled={disabled || existing.has(model.id)}
                  checked={
                    existing.has(model.id) || selected.includes(model.id)
                  }
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, model.id]
                        : selected.filter((id) => id !== model.id),
                    )
                  }
                />
                <span className="min-w-0 flex-1 break-all text-sm">
                  {model.display_name || model.id}
                  {model.display_name && (
                    <span className="block text-xs text-muted-foreground">
                      {model.id}
                    </span>
                  )}
                </span>
                {existing.has(model.id) && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    已添加
                  </span>
                )}
              </label>
            ))}
            {visible.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                {catalog.models.length
                  ? "没有匹配的模型"
                  : "提供方未返回可用模型，请检查账户权限。"}
              </p>
            )}
          </div>
          {catalog.truncated && (
            <p role="status" className="text-sm text-amber-700">
              列表未完整返回，当前显示已获取的模型。
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            获取列表不发送对话请求；模型是否支持所选调用方式以提供方为准。
          </p>
          <Button
            type="button"
            className="w-full"
            disabled={
              disabled || (!selected.length && !(savedName && apiKey.trim()))
            }
            onClick={() => void save()}
          >
            {selected.length
              ? `添加所选模型（${selected.length}）`
              : "更新提供方 Key"}
          </Button>
        </section>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}
