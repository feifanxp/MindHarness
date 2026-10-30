import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  CustomProviderSetup,
  connectCustomProvider,
  discoverCustomModels,
  savedCustomProviders,
} from "./customProvider";
import type { ModelConfig } from "@/types/config";

const { getState } = vi.hoisted(() => ({ getState: vi.fn() }));
vi.mock("@/store/configStore", () => ({
  useConfigStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector(getState()),
    { getState },
  ),
}));
const value = {
  name: "relay",
  baseUrl: "https://relay.example/v1",
  protocol: "responses" as const,
};
const model: ModelConfig = {
  provider: "openai",
  id: "vendor/model",
  api: "responses",
  credentials_service: "custom-provider:relay:key",
  extra_kwargs: { base_url: value.baseUrl },
};
const second = { ...model, id: "vendor-model" };
const updateConfigValue = vi.fn();
const saveConfig = vi.fn();
const state = {
  config: { models: {} as Record<string, ModelConfig> },
  isDirty: false,
  updateConfigValue,
  saveConfig,
};
function response(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 400, json: async () => body } as Response;
}
beforeEach(() => {
  vi.clearAllMocks();
  state.config = { models: {} };
  state.isDirty = false;
  getState.mockImplementation(() => state);
  saveConfig.mockResolvedValue({ status: "saved" });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        response({ models: [model, second], truncated: false }),
      ),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("custom provider catalogs", () => {
  it("fetches the model catalog without writing credentials or config", async () => {
    const result = await discoverCustomModels(value, " secret ");
    expect(result.models).toHaveLength(2);
    expect(fetch).toHaveBeenCalledWith(
      "/api/provider-setup/discover-models",
      expect.objectContaining({
        body: JSON.stringify({
          name: "relay",
          base_url: value.baseUrl,
          protocol: "responses",
          api_key: "secret",
        }),
      }),
    );
    expect(updateConfigValue).not.toHaveBeenCalled();
  });
  it("saves one shared key and multiple models with collision-safe names in one config write", async () => {
    state.config.models["relay-vendor-model"] = {
      provider: "openai",
      id: "original",
    };
    expect(await connectCustomProvider(value, "secret", [model, second])).toBe(
      2,
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "/api/credentials/custom-provider%3Arelay%3Akey/api-key",
    );
    expect(updateConfigValue).toHaveBeenCalledWith(["models"], {
      "relay-vendor-model": state.config.models["relay-vendor-model"],
      "relay-vendor-model-2": model,
      "relay-vendor-model-3": second,
    });
    expect(saveConfig).toHaveBeenCalledOnce();
    expect(JSON.stringify(updateConfigValue.mock.calls)).not.toContain(
      "secret",
    );
  });
  it("skips models already added and reuses a saved key without overwriting it", async () => {
    state.config.models.original = model;
    expect(await connectCustomProvider(value, "", [model, second])).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(updateConfigValue).toHaveBeenCalledWith(["models"], {
      original: model,
      "relay-vendor-model": second,
    });
  });
  it("makes a repeated selection a no-op", async () => {
    state.config.models.original = model;
    expect(await connectCustomProvider(value, "", [model])).toBe(0);
    expect(saveConfig).not.toHaveBeenCalled();
  });
  it("preserves dirty and concurrently modified config", async () => {
    state.isDirty = true;
    await expect(
      connectCustomProvider(value, "secret", [model]),
    ).rejects.toThrow("尚未保存");
    expect(fetch).not.toHaveBeenCalled();
    state.isDirty = false;
    vi.mocked(fetch).mockImplementationOnce(async () => {
      state.config = { models: { other: second } };
      return response({});
    });
    await expect(
      connectCustomProvider(value, "secret", [model]),
    ).rejects.toThrow("配置在保存期间发生变化");
    expect(updateConfigValue).not.toHaveBeenCalled();
  });
  it("reports rejected credentials and partial configuration saves", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      response({ detail: "Cannot save key" }, false),
    );
    await expect(
      connectCustomProvider(value, "secret", [model]),
    ).rejects.toThrow("Cannot save key");
    expect(updateConfigValue).not.toHaveBeenCalled();
    saveConfig.mockResolvedValue({ status: "stale" });
    await expect(
      connectCustomProvider(value, "secret", [model]),
    ).rejects.toThrow("模型配置未保存成功");
  });
  it("discovers saved providers from shared model configurations", () => {
    expect(savedCustomProviders({ one: model, two: second })).toEqual([value]);
    expect(
      savedCustomProviders({
        a: {
          ...model,
          provider: "anthropic",
          extra_kwargs: {
            client_params: { base_url: "https://relay.example" },
          },
        },
      }),
    ).toEqual([
      { ...value, protocol: "anthropic", baseUrl: "https://relay.example" },
    ]);
  });
  it("searches, selects multiple models and invalidates the list when connection changes", async () => {
    const onComplete = vi.fn();
    render(
      <CustomProviderSetup
        disabled={false}
        onBusyChange={vi.fn()}
        onComplete={onComplete}
      />,
    );
    fireEvent.change(screen.getByLabelText("提供方名称"), {
      target: { value: "relay" },
    });
    fireEvent.change(screen.getByLabelText("API 地址（Base URL）"), {
      target: { value: value.baseUrl },
    });
    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "获取 / 同步模型" }));
    await screen.findByRole("checkbox", { name: model.id });
    fireEvent.change(screen.getByLabelText("搜索模型"), {
      target: { value: "vendor/" },
    });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "全选搜索结果" }));
    fireEvent.change(screen.getByLabelText("搜索模型"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: second.id }));
    expect(
      screen.getByRole("button", { name: "添加所选模型（2）" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "添加所选模型（2）" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(2));
    fireEvent.change(screen.getByLabelText("调用方式"), {
      target: { value: "anthropic" },
    });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
  it("reopens an existing provider and disables models already added", async () => {
    state.config.models.original = model;
    render(
      <CustomProviderSetup
        disabled={false}
        onBusyChange={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("提供方"), {
      target: { value: "relay" },
    });
    expect(screen.getByLabelText("API Key")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "获取 / 同步模型" }));
    expect(
      await screen.findByRole("checkbox", { name: model.id }),
    ).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: second.id })).toBeEnabled();
  });
  it("shows a catalog failure without saving anything", async () => {
    vi.mocked(fetch).mockResolvedValue(response({ detail: "HTTP 404" }, false));
    await expect(discoverCustomModels(value, "secret")).rejects.toThrow(
      "HTTP 404",
    );
    expect(saveConfig).not.toHaveBeenCalled();
  });
});
