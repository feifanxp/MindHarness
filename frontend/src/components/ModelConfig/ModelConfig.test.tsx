import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelConfig } from "./ModelConfig";
import { useConfigStore } from "@/store/configStore";
import { useConfigSchema } from "@/hooks/useConfigSchema";

vi.mock("@/store/configStore", () => ({
  useConfigStore: vi.fn(),
}));
vi.mock("@/hooks/useConfigSchema", () => ({
  useConfigSchema: vi.fn(() => ({ schema: null, error: null })),
}));

vi.mock("@/components/ui/toaster", () => ({
  toast: vi.fn(),
}));

type KeyStatusResponse = {
  has_key: boolean;
  credential_service?: string;
  source?: string;
  masked_key?: string;
  api_key?: string;
};

function extractService(url: string): string {
  const marker = "/api/credentials/";
  const start = url.indexOf(marker);
  if (start === -1) return "";
  const rest = url.slice(start + marker.length);
  const end = rest.indexOf("/api-key");
  const service = end === -1 ? rest : rest.slice(0, end);
  const queryIndex = service.indexOf("?");
  return queryIndex === -1 ? service : service.slice(0, queryIndex);
}

function selectOpenAIOption() {
  const option = screen
    .getAllByRole("option")
    .find((element) => element.textContent?.includes("OpenAI"));
  if (!option) throw new Error("OpenAI provider option not found");
  fireEvent.click(option);
}

describe("ModelConfig", () => {
  const mockStore = {
    config: {
      models: {
        default: { provider: "ollama", id: "devstral-small-2:24b" },
        anthropic: {
          provider: "anthropic",
          id: "claude-haiku-4-5",
          pricing: { input: 1, output: 5 },
        },
        openrouter: { provider: "openrouter", id: "z-ai/glm-5.3" },
        openrouter_backup: {
          provider: "openrouter",
          id: "openai/gpt-5.6-terra",
        },
        openai_local: {
          provider: "openai",
          id: "gpt-5.6-terra",
          api: "responses",
          context_window: 16384,
          extra_kwargs: { base_url: "http://localhost:9292/v1" },
        },
      },
      agents: {},
      defaults: { markdown: true },
      router: { model: "default" },
    },
    updateConfigValue: vi.fn(),
    deleteModel: vi.fn(),
    saveConfig: vi.fn().mockResolvedValue({ status: "saved" }),
  };

  let keyStatusByService: Record<string, KeyStatusResponse>;
  let fetchMock: ReturnType<typeof vi.fn>;
  const writeTextMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useConfigSchema).mockReturnValue({
      schema: null,
      error: null,
      retry: vi.fn(),
    });

    const mockedUseConfigStore = useConfigStore as unknown as {
      mockReturnValue: (value: unknown) => void;
    };
    mockedUseConfigStore.mockReturnValue(mockStore);

    keyStatusByService = {
      "model:openrouter_backup": {
        has_key: true,
        source: "ui",
        masked_key: "sk-ob...9999",
        api_key: "sk-openrouter-backup-real",
      },
    };
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method || "GET";
      const url = typeof input === "string" ? input : input.toString();

      if (method === "GET" && url.includes("/api-key")) {
        const service = extractService(url);
        const payload = keyStatusByService[service] || { has_key: false };
        return {
          ok: true,
          json: async () => payload,
        };
      }

      return {
        ok: true,
        json: async () => ({ status: "success" }),
      };
    });

    Object.defineProperty(global, "fetch", {
      value: fetchMock,
      writable: true,
      configurable: true,
    });

    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { writeText: writeTextMock } },
      writable: true,
      configurable: true,
    });
  });

  it("renders configured rows", () => {
    render(<ModelConfig />);

    expect(screen.getByText("default")).toBeTruthy();
    expect(screen.getByText("anthropic")).toBeTruthy();
    expect(screen.getByText("openrouter")).toBeTruthy();
    expect(screen.getByText("openai_local")).toBeTruthy();
  });

  it("keeps the models table horizontally scrollable", () => {
    render(<ModelConfig />);

    const scrollContainer = screen.getByTestId("models-table-scroll-container");
    expect(scrollContainer).toHaveClass("overflow-x-auto");
    expect(within(scrollContainer).getByRole("table")).toBeTruthy();
  });

  it("shows provider keys resolved from their env-var-named service", async () => {
    keyStatusByService.anthropic = {
      has_key: true,
      credential_service: "ANTHROPIC_API_KEY",
      source: "ui",
      masked_key: "sk-a...-key",
    };
    keyStatusByService.openrouter = {
      has_key: true,
      credential_service: "openrouter",
      source: "env",
      masked_key: "sk-o...-key",
    };

    render(<ModelConfig />);

    await waitFor(() => {
      expect(
        screen.getByText("Source: UI, saved as ANTHROPIC_API_KEY"),
      ).toBeTruthy();
    });
    expect(screen.getAllByText(/saved as/)).toHaveLength(1);
  });

  it("starts inline editing when a row is clicked", () => {
    render(<ModelConfig />);

    fireEvent.click(screen.getByText("anthropic"));

    expect(screen.getByDisplayValue("anthropic")).toBeTruthy();
    expect(screen.getByDisplayValue("claude-haiku-4-5")).toBeTruthy();
  });

  it("saves inline name and model-id edits", async () => {
    render(<ModelConfig />);

    fireEvent.click(screen.getByText("anthropic"));

    const row = screen.getByDisplayValue("anthropic").closest("tr");
    if (!row) throw new Error("row not found");

    fireEvent.change(within(row).getByDisplayValue("anthropic"), {
      target: { value: "anthropic-fast" },
    });
    fireEvent.change(within(row).getByDisplayValue("claude-haiku-4-5"), {
      target: { value: "claude-sonnet-5" },
    });

    fireEvent.click(within(row).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockStore.updateConfigValue).toHaveBeenCalledWith(
        ["models", "anthropic-fast"],
        expect.objectContaining({
          provider: "anthropic",
          id: "claude-sonnet-5",
          // Budget prices are edited on the Budgets page and survive row edits.
          pricing: { input: 1, output: 5 },
        }),
      );
      expect(mockStore.deleteModel).toHaveBeenCalledWith("anthropic");
    });
  });

  it("deletes old custom credential when renaming a model", async () => {
    keyStatusByService["model:anthropic"] = {
      has_key: true,
      source: "ui",
      masked_key: "sk-an...1234",
      api_key: "sk-anthropic-real",
    };

    render(<ModelConfig />);

    await waitFor(() => {
      expect(screen.getAllByText("Source: UI").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByText("anthropic"));

    const row = screen.getByDisplayValue("anthropic").closest("tr");
    if (!row) throw new Error("row not found");

    fireEvent.change(within(row).getByDisplayValue("anthropic"), {
      target: { value: "anthropic-renamed" },
    });
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/credentials/model:anthropic-renamed/copy-from/model:anthropic",
        { method: "POST" },
      );
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/credentials/model:anthropic",
        {
          method: "DELETE",
        },
      );
    });
  });

  it("keeps focus in model id input while typing", () => {
    render(<ModelConfig />);

    fireEvent.click(screen.getByText("anthropic"));

    const row = screen.getByDisplayValue("anthropic").closest("tr");
    if (!row) throw new Error("row not found");

    const modelIdInput = within(row).getByDisplayValue("claude-haiku-4-5");
    modelIdInput.focus();
    expect(modelIdInput).toHaveFocus();

    fireEvent.change(modelIdInput, {
      target: { value: "claude-haiku-4-5a" },
    });

    const updatedInput = within(row).getByDisplayValue("claude-haiku-4-5a");
    expect(updatedInput).toBe(modelIdInput);
    expect(updatedInput).toHaveFocus();
  });

  it("shows OpenAI endpoint details and allows editing base URL", async () => {
    render(<ModelConfig />);

    expect(
      screen.getAllByText(
        (_, element) =>
          element?.textContent?.includes(
            "Endpoint: http://localhost:9292/v1",
          ) ?? false,
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        (_, element) =>
          element?.textContent?.includes("Context window: 16,384") ?? false,
      ).length,
    ).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("openai_local"));
    const row = screen.getByDisplayValue("openai_local").closest("tr");
    if (!row) throw new Error("row not found");

    expect(
      within(row).getByDisplayValue("http://localhost:9292/v1"),
    ).toBeTruthy();
    expect(within(row).getByDisplayValue("16384")).toBeTruthy();

    fireEvent.change(
      within(row).getByDisplayValue("http://localhost:9292/v1"),
      {
        target: { value: "http://localhost:11434/v1" },
      },
    );
    fireEvent.change(within(row).getByDisplayValue("16384"), {
      target: { value: "32768" },
    });
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockStore.updateConfigValue).toHaveBeenCalledWith(
        ["models", "openai_local"],
        expect.objectContaining({
          provider: "openai",
          id: "gpt-5.6-terra",
          context_window: 32768,
          api: "responses",
          extra_kwargs: { base_url: "http://localhost:11434/v1" },
        }),
      );
    });
  });

  it("clears OpenAI API selection when changing provider", async () => {
    render(<ModelConfig />);
    fireEvent.click(screen.getByText("openai_local"));
    const row = screen.getByDisplayValue("openai_local").closest("tr");
    if (!row) throw new Error("row not found");

    fireEvent.click(within(row).getAllByRole("combobox")[0]);
    fireEvent.click(screen.getByRole("option", { name: /Anthropic/i }));
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockStore.updateConfigValue).toHaveBeenCalledWith(
        ["models", "openai_local"],
        {
          provider: "anthropic",
          id: "gpt-5.6-terra",
          context_window: 16384,
        },
      );
    });
  });

  function addModels(models: Record<string, Record<string, unknown>>) {
    vi.mocked(useConfigStore).mockReturnValue({
      ...mockStore,
      config: {
        ...mockStore.config,
        models: { ...mockStore.config.models, ...models },
      },
    } as unknown as ReturnType<typeof useConfigStore>);
  }

  function addKeyedOpenAIModel(fields: Record<string, unknown>) {
    addModels({ keyed: { provider: "openai", id: "gpt-6-astra", ...fields } });
  }

  function editKeyedRow(): HTMLElement {
    fireEvent.click(screen.getByText("keyed"));
    const row = screen.getByDisplayValue("keyed").closest("tr");
    if (!row) throw new Error("row not found");
    return row;
  }

  function chooseProvider(row: HTMLElement, name: RegExp) {
    fireEvent.click(within(row).getAllByRole("combobox")[0]);
    fireEvent.click(screen.getByRole("option", { name }));
  }

  async function renderWithSavedKeyedModelKey() {
    keyStatusByService["model:keyed"] = {
      has_key: true,
      source: "ui",
      masked_key: "sk-op...1234",
    };
    render(<ModelConfig />);
    await waitFor(() => {
      expect(screen.getAllByText("Source: UI").length).toBeGreaterThan(0);
    });
  }

  function deleteCallsFor(service: string) {
    return fetchMock.mock.calls.filter(
      ([url, init]) =>
        url === `/api/credentials/${service}` &&
        typeof init === "object" &&
        init?.method === "DELETE",
    );
  }

  it.each([
    { api_key: "sk-openai-config", extra_kwargs: { temperature: 0.2 } },
    { extra_kwargs: { api_key: "sk-openai-config", temperature: 0.2 } },
  ])(
    "drops config.yaml API keys when changing provider (%o)",
    async (keyFields) => {
      addKeyedOpenAIModel(keyFields);
      render(<ModelConfig />);
      const row = editKeyedRow();
      chooseProvider(row, /DeepSeek/i);
      fireEvent.click(within(row).getByRole("button", { name: "Save" }));

      await waitFor(() => {
        expect(mockStore.updateConfigValue).toHaveBeenCalledWith(
          ["models", "keyed"],
          {
            provider: "deepseek",
            id: "gpt-6-astra",
            extra_kwargs: { temperature: 0.2 },
          },
        );
      });
    },
  );

  it("clears a saved dashboard key when changing provider", async () => {
    addKeyedOpenAIModel({});
    await renderWithSavedKeyedModelKey();

    const row = editKeyedRow();
    chooseProvider(row, /DeepSeek/i);
    expect(
      within(row).getByText(
        "Custom key will be removed on save because the provider changed.",
      ),
    ).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(deleteCallsFor("model:keyed")).toHaveLength(1);
    });
  });

  it.each([
    { provider: /DeepSeek/i, newKey: "paste" },
    { provider: /DeepSeek/i, newKey: "reuse" },
    { provider: /Ollama/i, newKey: "none" },
  ])(
    "removes the old saved key once when a renamed model switches provider ($newKey)",
    async ({ provider, newKey }) => {
      addModels({
        keyed: { provider: "openai", id: "gpt-6-astra" },
        deepseek_other: { provider: "deepseek", id: "deepseek-flash" },
      });
      keyStatusByService["model:deepseek_other"] = {
        has_key: true,
        source: "ui",
        masked_key: "sk-ds...0000",
      };
      await renderWithSavedKeyedModelKey();

      const row = editKeyedRow();
      fireEvent.change(within(row).getByDisplayValue("keyed"), {
        target: { value: "keyed2" },
      });
      chooseProvider(row, provider);
      if (newKey === "paste") {
        fireEvent.change(
          within(row).getByPlaceholderText("Paste new API key"),
          {
            target: { value: "sk-new" },
          },
        );
      } else if (newKey === "reuse") {
        const reuseTrigger = within(row)
          .getByText("Reuse from same provider")
          .closest("button");
        if (!reuseTrigger) throw new Error("reuse trigger not found");
        fireEvent.click(reuseTrigger);
        fireEvent.click(
          screen.getByRole("option", { name: /deepseek_other/i }),
        );
      }
      fireEvent.click(within(row).getByRole("button", { name: "Save" }));

      await waitFor(() => {
        expect(mockStore.deleteModel).toHaveBeenCalledWith("keyed");
      });
      expect(deleteCallsFor("model:keyed")).toHaveLength(1);
    },
  );

  it("keeps the saved key when the provider is switched back before saving", async () => {
    addKeyedOpenAIModel({ api_key: "sk-openai-config" });
    await renderWithSavedKeyedModelKey();

    const row = editKeyedRow();
    chooseProvider(row, /DeepSeek/i);
    chooseProvider(row, /OpenAI/i);
    expect(
      within(row).getByText("This model keeps its saved custom key."),
    ).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockStore.updateConfigValue).toHaveBeenCalledWith(
        ["models", "keyed"],
        {
          provider: "openai",
          id: "gpt-6-astra",
          api_key: "sk-openai-config",
        },
      );
    });
    expect(deleteCallsFor("model:keyed")).toHaveLength(0);
  });

  it("shows no key status for providers that authenticate without a key", async () => {
    addModels({
      codex_model: { provider: "codex", id: "gpt-6-astra" },
      vertex_model: { provider: "vertexai_claude", id: "claude-opus-5" },
    });
    keyStatusByService["vertexai_claude"] = { has_key: true, source: "env" };
    render(<ModelConfig />);

    for (const modelName of ["codex_model", "vertex_model"]) {
      const row = screen.getByText(modelName).closest("tr");
      if (!row) throw new Error("row not found");
      expect(within(row).getByText("N/A")).toBeTruthy();
    }
    fireEvent.click(screen.getByText("vertex_model"));
    const row = screen.getByDisplayValue("vertex_model").closest("tr");
    if (!row) throw new Error("row not found");
    expect(within(row).getByText(/^No key needed for/)).toBeTruthy();
    expect(within(row).queryByPlaceholderText("Paste new API key")).toBeNull();
  });

  it("labels a config.yaml key without offering to copy it", async () => {
    addKeyedOpenAIModel({ api_key: "sk-openai-config" });
    keyStatusByService["openai"] = {
      has_key: true,
      source: "env",
      masked_key: "sk-en...5678",
    };
    render(<ModelConfig />);

    const row = screen.getByText("keyed").closest("tr");
    const providerKeyRow = screen.getByText("openai_local").closest("tr");
    if (!row || !providerKeyRow) throw new Error("row not found");
    await waitFor(() => {
      expect(within(providerKeyRow).getByText("Provider key")).toBeTruthy();
    });
    expect(within(row).getByText("Config key")).toBeTruthy();
    expect(within(row).queryByText("Provider key")).toBeNull();
    expect(within(row).queryByTitle("Copy API key")).toBeNull();
  });

  const customCatalogModels = {
    relay_a: {
      provider: "openai",
      id: "test-a",
      credentials_service: "custom-provider:relayA:key",
      api: "responses",
      extra_kwargs: { base_url: "https://a.example/v1" },
    },
    relay_b: {
      provider: "openai",
      id: "test-b",
      credentials_service: "custom-provider:relayB:key",
      api: "chat_completions",
      extra_kwargs: { base_url: "https://b.example/v1" },
    },
    relay_claude: {
      provider: "anthropic",
      id: "test-c",
      credentials_service: "custom-provider:relayClaude:key",
      extra_kwargs: { client_params: { base_url: "https://c.example" } },
    },
  };

  function withCustomProviders() {
    vi.mocked(useConfigStore).mockReturnValue({
      ...mockStore,
      config: {
        ...mockStore.config,
        models: { ...mockStore.config.models, ...customCatalogModels },
      },
    });
    keyStatusByService["custom-provider:relayA:key"] = {
      has_key: true,
      source: "ui",
      masked_key: "relay-A-key",
    };
    keyStatusByService["custom-provider:relayB:key"] = {
      has_key: true,
      source: "ui",
      masked_key: "relay-B-key",
    };
  }

  it("labels saved custom providers and includes them in the edit selector", async () => {
    withCustomProviders();
    render(<ModelConfig />);
    const savedRow = screen.getByText("relay_a").closest("tr")!;
    expect(within(savedRow).getByText("relayA")).toBeInTheDocument();
    fireEvent.click(screen.getByText("default"));
    const row = screen.getByDisplayValue("default").closest("tr")!;
    fireEvent.click(within(row).getAllByRole("combobox")[0]);
    expect(
      screen.getByRole("option", { name: "relayA · 第三方 API" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "relayB · 第三方 API" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("option", { name: "relayA · 第三方 API" }),
    );
    expect(within(row).getByLabelText("API Base URL")).toHaveValue(
      "https://a.example/v1",
    );
    expect(within(row).getByLabelText("API Base URL")).toHaveAttribute(
      "readonly",
    );
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mockStore.updateConfigValue).toHaveBeenCalledWith(
        ["models", "default"],
        expect.objectContaining({
          provider: "openai",
          credentials_service: "custom-provider:relayA:key",
          api: "responses",
          extra_kwargs: { base_url: "https://a.example/v1" },
        }),
      ),
    );
  });

  it("switches between custom endpoints with the same SDK and clears the old model key", async () => {
    withCustomProviders();
    keyStatusByService["model:relay_a"] = {
      has_key: true,
      source: "ui",
      masked_key: "old-model-key",
    };
    render(<ModelConfig />);
    await screen.findByText("old-model-key");
    fireEvent.click(screen.getByText("relay_a"));
    const row = screen.getByDisplayValue("relay_a").closest("tr")!;
    fireEvent.click(within(row).getAllByRole("combobox")[0]);
    fireEvent.click(
      screen.getByRole("option", { name: "relayB · 第三方 API" }),
    );
    expect(within(row).queryByText("old-model-key")).not.toBeInTheDocument();
    expect(within(row).getByLabelText("API Base URL")).toHaveValue(
      "https://b.example/v1",
    );
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mockStore.updateConfigValue).toHaveBeenCalledWith(
        ["models", "relay_a"],
        expect.objectContaining({
          credentials_service: "custom-provider:relayB:key",
          api: "chat_completions",
          extra_kwargs: { base_url: "https://b.example/v1" },
        }),
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/credentials/model:relay_a", {
      method: "DELETE",
    });
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).includes("custom-provider:relayA:key") &&
          init?.method === "DELETE",
      ),
    ).toBe(false);
  });

  it("removes the custom binding when switching back to official OpenAI", async () => {
    withCustomProviders();
    render(<ModelConfig />);
    fireEvent.click(screen.getByText("relay_a"));
    const row = screen.getByDisplayValue("relay_a").closest("tr")!;
    fireEvent.click(within(row).getAllByRole("combobox")[0]);
    fireEvent.click(screen.getByRole("option", { name: "OpenAI" }));
    expect(within(row).getByLabelText("API Base URL")).toHaveValue("");
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mockStore.updateConfigValue).toHaveBeenCalledWith(
        ["models", "relay_a"],
        { provider: "openai", id: "test-a" },
      ),
    );
  });

  it.each([
    ["relayA", "openai", "responses", { base_url: "https://a.example/v1" }],
    [
      "relayClaude",
      "anthropic",
      undefined,
      { client_params: { base_url: "https://c.example" } },
    ],
  ])(
    "adds a model bound to %s with its shared connection",
    async (name, provider, api, extra_kwargs) => {
      withCustomProviders();
      render(<ModelConfig />);
      fireEvent.click(screen.getByRole("button", { name: "Add Model" }));
      fireEvent.change(screen.getByPlaceholderText("model name"), {
        target: { value: "added" },
      });
      const row = screen.getByDisplayValue("added").closest("tr")!;
      fireEvent.click(within(row).getAllByRole("combobox")[0]);
      fireEvent.click(
        screen.getByRole("option", { name: String(name) + " · 第三方 API" }),
      );
      fireEvent.change(within(row).getByPlaceholderText("provider model id"), {
        target: { value: "test-new" },
      });
      fireEvent.click(within(row).getByRole("button", { name: "Add" }));
      await waitFor(() =>
        expect(mockStore.updateConfigValue).toHaveBeenCalledWith(
          ["models", "added"],
          expect.objectContaining({
            provider,
            id: "test-new",
            credentials_service: "custom-provider:" + name + ":key",
            extra_kwargs,
          }),
        ),
      );
      const saved = mockStore.updateConfigValue.mock.calls.find(
        ([path]) => path[1] === "added",
      )![1];
      expect(saved.api).toBe(api);
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === "POST"),
      ).toBe(false);
    },
  );

  it("explains a URL entered as context window and saves the provider change after it is cleared", async () => {
    withCustomProviders();
    render(<ModelConfig />);
    fireEvent.click(screen.getByText("default"));
    const row = screen.getByDisplayValue("default").closest("tr")!;
    fireEvent.click(within(row).getAllByRole("combobox")[0]);
    fireEvent.click(
      screen.getByRole("option", { name: "relayA · 第三方 API" }),
    );
    const contextWindow =
      within(row).getByLabelText("上下文窗口（tokens，可选）");
    const endpoint = within(row).getByLabelText("API Base URL");
    fireEvent.change(contextWindow, {
      target: { value: "https://a.example/v1" },
    });
    expect(contextWindow).toHaveAttribute("aria-invalid", "true");
    expect(within(row).getByRole("alert")).toHaveTextContent(
      "这里是上下文窗口，不是 API 地址",
    );
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    expect(mockStore.updateConfigValue).not.toHaveBeenCalled();
    expect(endpoint).toHaveValue("https://a.example/v1");
    fireEvent.change(contextWindow, { target: { value: "" } });
    expect(contextWindow).toHaveAttribute("aria-invalid", "false");
    expect(within(row).queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mockStore.updateConfigValue).toHaveBeenCalledWith(
        ["models", "default"],
        expect.objectContaining({
          provider: "openai",
          credentials_service: "custom-provider:relayA:key",
          api: "responses",
          extra_kwargs: { base_url: "https://a.example/v1" },
        }),
      ),
    );
    const saved = mockStore.updateConfigValue.mock.calls.find(
      ([path]) => path[1] === "default",
    )![1];
    expect(saved).not.toHaveProperty("context_window");
  });

  it.each(["0", "-1", "1.5", "9007199254740992"])(
    "rejects invalid context window %s without losing the draft",
    (value) => {
      render(<ModelConfig />);
      fireEvent.click(screen.getByText("default"));
      const row = screen.getByDisplayValue("default").closest("tr")!;
      const input = within(row).getByLabelText("上下文窗口（tokens，可选）");
      fireEvent.change(input, { target: { value } });
      fireEvent.click(within(row).getByRole("button", { name: "Save" }));
      expect(input).toHaveValue(value);
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(mockStore.updateConfigValue).not.toHaveBeenCalled();
    },
  );

  it("changes provider with inline dropdown", async () => {
    render(<ModelConfig />);

    fireEvent.click(screen.getByText("openrouter"));

    const row = screen.getByDisplayValue("openrouter").closest("tr");
    if (!row) throw new Error("row not found");

    fireEvent.click(within(row).getAllByRole("combobox")[0]);
    fireEvent.click(screen.getByRole("option", { name: /OpenAI/i }));

    fireEvent.click(within(row).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockStore.updateConfigValue).toHaveBeenCalledWith(
        ["models", "openrouter"],
        expect.objectContaining({ provider: "openai" }),
      );
    });
  });

  it("shows API key source labels", async () => {
    keyStatusByService["model:anthropic"] = {
      has_key: true,
      source: "ui",
      masked_key: "sk-an...1234",
      api_key: "sk-anthropic-real",
    };
    keyStatusByService["openrouter"] = {
      has_key: true,
      source: "env",
      masked_key: "sk-en...5678",
      api_key: "sk-openrouter-env-real",
    };

    render(<ModelConfig />);

    await waitFor(() => {
      expect(screen.getAllByText("Source: UI").length).toBeGreaterThan(0);
      expect(
        screen.getAllByText(
          (_, element) =>
            element?.textContent?.includes("Source: .env") ?? false,
        ).length,
      ).toBeGreaterThan(0);
    });
  });

  it("reuses key from another same-provider model", async () => {
    render(<ModelConfig />);

    fireEvent.click(screen.getByText("openrouter"));

    const row = screen.getByDisplayValue("openrouter").closest("tr");
    if (!row) throw new Error("row not found");

    await waitFor(() => {
      expect(within(row).getByText("Reuse from same provider")).toBeTruthy();
    });

    const reuseTrigger = within(row)
      .getByText("Reuse from same provider")
      .closest("button");
    if (!reuseTrigger) throw new Error("reuse trigger not found");

    fireEvent.click(reuseTrigger);
    fireEvent.click(screen.getByRole("option", { name: /openrouter_backup/i }));
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/credentials/model:openrouter/copy-from/model:openrouter_backup",
        { method: "POST" },
      );
    });
  });

  it("shows and copies the explicit shared provider key instead of an official key", async () => {
    const service = "custom-provider:relay:key";
    vi.mocked(useConfigStore).mockReturnValue({
      ...mockStore,
      config: {
        ...mockStore.config,
        models: {
          relay: {
            provider: "openai",
            id: "test",
            credentials_service: service,
          },
        },
      },
    });
    keyStatusByService[service] = {
      has_key: true,
      source: "ui",
      masked_key: "relay...key",
      api_key: "relay-key",
    };
    keyStatusByService.openai = {
      has_key: true,
      source: "env",
      masked_key: "official...key",
      api_key: "official-key",
    };
    render(<ModelConfig />);
    const row = screen.getByText("relay").closest("tr")!;
    await waitFor(() =>
      expect(within(row).getByText("relay...key")).toBeInTheDocument(),
    );
    expect(within(row).queryByText("official...key")).not.toBeInTheDocument();
    fireEvent.click(within(row).getByTitle("Copy API key"));
    await waitFor(() =>
      expect(writeTextMock).toHaveBeenCalledWith("relay-key"),
    );
  });

  it("does not display the official key when an explicit shared provider key is missing", async () => {
    vi.mocked(useConfigStore).mockReturnValue({
      ...mockStore,
      config: {
        ...mockStore.config,
        models: {
          relay: {
            provider: "openai",
            id: "test",
            credentials_service: "custom-provider:relay:key",
          },
        },
      },
    });
    keyStatusByService.openai = {
      has_key: true,
      source: "env",
      masked_key: "official...key",
    };
    render(<ModelConfig />);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/credentials/custom-provider:relay:key/api-key?key_name=api_key",
      ),
    );
    const row = screen.getByText("relay").closest("tr")!;
    expect(within(row).queryByTitle("Copy API key")).not.toBeInTheDocument();
    expect(within(row).queryByText("official...key")).not.toBeInTheDocument();
  });

  it("copies API key via copy button", async () => {
    keyStatusByService["model:anthropic"] = {
      has_key: true,
      source: "ui",
      masked_key: "sk-an...1234",
      api_key: "sk-anthropic-real",
    };

    render(<ModelConfig />);

    const row = screen.getByText("anthropic").closest("tr");
    if (!row) throw new Error("row not found");

    await waitFor(() => {
      expect(within(row).getByTitle("Copy API key")).toBeTruthy();
    });

    fireEvent.click(within(row).getByTitle("Copy API key"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/credentials/model:anthropic/api-key?key_name=api_key&include_value=true",
      );
      expect(writeTextMock).toHaveBeenCalledWith("sk-anthropic-real");
    });
  });

  it("adds a model using the top add row", async () => {
    render(<ModelConfig />);

    fireEvent.click(screen.getByRole("button", { name: /add model/i }));

    expect(
      screen.getByText(
        "No custom key provided. This model will use the provider key (for example from .env) when available.",
      ),
    ).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("model name"), {
      target: { value: "new-model" },
    });
    fireEvent.change(screen.getByPlaceholderText("provider model id"), {
      target: { value: "openai/gpt-5.6-terra" },
    });
    fireEvent.change(screen.getByLabelText("上下文窗口（tokens，可选）"), {
      target: { value: "200000" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));

    await waitFor(() => {
      expect(mockStore.updateConfigValue).toHaveBeenCalledWith(
        ["models", "new-model"],
        {
          provider: "openrouter",
          id: "openai/gpt-5.6-terra",
          context_window: 200000,
        },
      );
    });
  });

  it("accepts empty base URL for OpenAI and uses default endpoint", async () => {
    render(<ModelConfig />);

    fireEvent.click(screen.getByRole("button", { name: /add model/i }));
    const addRow = screen.getByPlaceholderText("model name").closest("tr");
    if (!addRow) throw new Error("add row not found");

    fireEvent.click(within(addRow).getAllByRole("combobox")[0]);
    selectOpenAIOption();

    fireEvent.change(within(addRow).getByPlaceholderText("model name"), {
      target: { value: "openai_default" },
    });
    fireEvent.change(within(addRow).getByPlaceholderText("provider model id"), {
      target: { value: "gpt-5.6-terra" },
    });

    expect(
      within(addRow).getByPlaceholderText("https://api.openai.com/v1"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));

    await waitFor(() => {
      expect(mockStore.updateConfigValue).toHaveBeenCalledWith(
        ["models", "openai_default"],
        {
          provider: "openai",
          id: "gpt-5.6-terra",
        },
      );
    });
  });

  it("validates custom OpenAI base URL on add", async () => {
    const { toast } = await import("@/components/ui/toaster");

    render(<ModelConfig />);

    fireEvent.click(screen.getByRole("button", { name: /add model/i }));
    const addRow = screen.getByPlaceholderText("model name").closest("tr");
    if (!addRow) throw new Error("add row not found");

    fireEvent.click(within(addRow).getAllByRole("combobox")[0]);
    selectOpenAIOption();

    fireEvent.change(within(addRow).getByPlaceholderText("model name"), {
      target: { value: "openai_compat" },
    });
    fireEvent.change(within(addRow).getByPlaceholderText("provider model id"), {
      target: { value: "gpt-5.6-terra" },
    });
    fireEvent.change(
      within(addRow).getByPlaceholderText("https://api.openai.com/v1"),
      {
        target: { value: "not-a-url" },
      },
    );

    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Error",
          description: "Base URL must be a valid http(s) URL",
          variant: "destructive",
        }),
      );
    });
  });

  it("saves custom OpenAI base URL on add", async () => {
    render(<ModelConfig />);

    fireEvent.click(screen.getByRole("button", { name: /add model/i }));
    const addRow = screen.getByPlaceholderText("model name").closest("tr");
    if (!addRow) throw new Error("add row not found");

    fireEvent.click(within(addRow).getAllByRole("combobox")[0]);
    selectOpenAIOption();

    fireEvent.change(within(addRow).getByPlaceholderText("model name"), {
      target: { value: "openai_compat" },
    });
    fireEvent.change(within(addRow).getByPlaceholderText("provider model id"), {
      target: { value: "gpt-5.6-terra" },
    });
    fireEvent.change(
      within(addRow).getByPlaceholderText("https://api.openai.com/v1"),
      {
        target: { value: "http://localhost:9292/v1" },
      },
    );

    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));

    await waitFor(() => {
      expect(mockStore.updateConfigValue).toHaveBeenCalledWith(
        ["models", "openai_compat"],
        {
          provider: "openai",
          id: "gpt-5.6-terra",
          extra_kwargs: { base_url: "http://localhost:9292/v1" },
        },
      );
    });
  });

  it("shows immediate feedback when clearing a custom key", async () => {
    keyStatusByService["model:anthropic"] = {
      has_key: true,
      source: "ui",
      masked_key: "sk-an...1234",
      api_key: "sk-anthropic-real",
    };

    render(<ModelConfig />);

    await waitFor(() => {
      expect(screen.getAllByText("Source: UI").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByText("anthropic"));
    const row = screen.getByDisplayValue("anthropic").closest("tr");
    if (!row) throw new Error("row not found");

    fireEvent.click(
      within(row).getByRole("button", { name: "Clear custom key" }),
    );

    expect(
      within(row).getByText("Custom key will be removed on save."),
    ).toBeTruthy();
    expect(
      within(row).getByRole("button", { name: "Undo clear key" }),
    ).toBeTruthy();

    fireEvent.click(within(row).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/credentials/model:anthropic",
        {
          method: "DELETE",
        },
      );
    });
  });

  it("deletes custom key only once when clearing key and renaming model", async () => {
    keyStatusByService["model:anthropic"] = {
      has_key: true,
      source: "ui",
      masked_key: "sk-an...1234",
      api_key: "sk-anthropic-real",
    };

    render(<ModelConfig />);

    await waitFor(() => {
      expect(screen.getAllByText("Source: UI").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByText("anthropic"));
    const row = screen.getByDisplayValue("anthropic").closest("tr");
    if (!row) throw new Error("row not found");

    fireEvent.change(within(row).getByDisplayValue("anthropic"), {
      target: { value: "anthropic-cleared" },
    });
    fireEvent.click(
      within(row).getByRole("button", { name: "Clear custom key" }),
    );
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const deleteCalls = fetchMock.mock.calls.filter(
        ([url, init]) =>
          url === "/api/credentials/model:anthropic" &&
          typeof init === "object" &&
          init?.method === "DELETE",
      );
      expect(deleteCalls).toHaveLength(1);
      expect(fetchMock).not.toHaveBeenCalledWith(
        "/api/credentials/model:anthropic-cleared/copy-from/model:anthropic",
        { method: "POST" },
      );
    });
  });

  it("deletes non-default models and keeps default protected", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<ModelConfig />);

    const nonDefaultRow = screen.getByText("openrouter").closest("tr");
    const defaultRow = screen.getByText("default").closest("tr");
    if (!nonDefaultRow || !defaultRow) throw new Error("rows not found");

    fireEvent.click(within(nonDefaultRow).getByTitle("Delete"));
    expect(mockStore.deleteModel).toHaveBeenCalledWith("openrouter");

    expect(within(defaultRow).queryByTitle("Delete")).toBeNull();

    confirmSpy.mockRestore();
  });

  it("shows a toast when Save All Changes is superseded by newer draft edits", async () => {
    mockStore.saveConfig.mockResolvedValueOnce({ status: "stale" });
    const user = userEvent.setup();

    render(<ModelConfig />);

    await user.click(screen.getByRole("button", { name: "Save All Changes" }));

    const { toast } = await import("@/components/ui/toaster");
    await waitFor(() => {
      expect(mockStore.saveConfig).toHaveBeenCalledTimes(1);
      expect(toast).toHaveBeenCalledWith({
        title: "Save Failed",
        description: "Save was superseded by newer draft edits.",
        variant: "destructive",
      });
    });
  });

  it("edits model fields the table does not render through More settings", () => {
    vi.mocked(useConfigStore).mockReturnValue({
      ...mockStore,
      agents: [],
      rooms: [],
      diagnostics: [],
    } as never);
    vi.mocked(useConfigSchema).mockReturnValue({
      schema: {
        type: "object",
        properties: {},
        $defs: {
          ModelConfig: {
            type: "object",
            properties: {
              provider: { type: "string" },
              host: {
                anyOf: [{ type: "string" }, { type: "null" }],
                default: null,
                description: "Optional host URL (e.g., for Ollama)",
              },
            },
          },
        },
      },
      error: null,
      retry: vi.fn(),
    });

    render(<ModelConfig />);
    fireEvent.click(screen.getByText("default"));
    fireEvent.click(
      screen.getByRole("button", { name: /More settings for default/ }),
    );
    fireEvent.change(screen.getByLabelText("Host"), {
      target: { value: "http://ollama:11434" },
    });

    expect(mockStore.updateConfigValue).toHaveBeenLastCalledWith(
      ["models", "default", "host"],
      "http://ollama:11434",
    );
  });

  it("hides More settings fields that saving the row drops for its provider", () => {
    vi.mocked(useConfigStore).mockReturnValue({
      ...mockStore,
      agents: [],
      rooms: [],
      diagnostics: [],
    } as never);
    vi.mocked(useConfigSchema).mockReturnValue({
      schema: {
        type: "object",
        properties: {},
        $defs: {
          ModelConfig: {
            type: "object",
            properties: {
              provider: { type: "string" },
              api: {
                anyOf: [{ type: "string" }, { type: "null" }],
                default: null,
              },
              host: {
                anyOf: [{ type: "string" }, { type: "null" }],
                default: null,
              },
              extra_kwargs: { anyOf: [{ type: "object" }, { type: "null" }] },
            },
          },
        },
      },
      error: null,
      retry: vi.fn(),
    });

    render(<ModelConfig />);
    fireEvent.click(screen.getByText("openai_local"));
    expect(
      screen.getByRole("button", { name: /More settings for openai_local/ }),
    ).toHaveTextContent("API, Extra kwargs");

    const row = screen.getByDisplayValue("openai_local").closest("tr");
    if (!row) throw new Error("row not found");
    fireEvent.click(within(row).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByText("default"));
    expect(
      screen.getByRole("button", { name: /More settings for default/ }),
    ).toHaveTextContent("Host, Extra kwargs");
  });

  describe("while More settings edit the model being edited", () => {
    const withEditedExtraKwargs = () => ({
      ...mockStore,
      config: {
        ...mockStore.config,
        models: {
          ...mockStore.config.models,
          openai_local: {
            ...mockStore.config.models.openai_local,
            extra_kwargs: {
              base_url: "http://proxy:8080/v1",
              temperature: 0.2,
            },
          },
        },
      },
    });

    it("keeps the More settings base URL when the row's Base URL is untouched", async () => {
      const { rerender } = render(<ModelConfig />);
      fireEvent.click(screen.getByText("openai_local"));
      vi.mocked(useConfigStore).mockReturnValue(
        withEditedExtraKwargs() as never,
      );
      rerender(<ModelConfig />);

      const row = screen.getByDisplayValue("openai_local").closest("tr");
      if (!row) throw new Error("row not found");
      fireEvent.click(within(row).getByRole("button", { name: "Save" }));

      await waitFor(() => {
        expect(mockStore.updateConfigValue).toHaveBeenCalledWith(
          ["models", "openai_local"],
          expect.objectContaining({
            extra_kwargs: {
              base_url: "http://proxy:8080/v1",
              temperature: 0.2,
            },
          }),
        );
      });
    });

    it("reverts only the More settings edits made since the last save", () => {
      const updateConfigValue = vi.fn();
      const { rerender } = render(<ModelConfig />);
      fireEvent.click(screen.getByText("openai_local"));
      // A save committed the edited model, whatever its result status, and
      // a later edit changed it again.
      const committed = withEditedExtraKwargs().config;
      const draft = {
        ...committed,
        models: {
          ...committed.models,
          openai_local: {
            ...committed.models.openai_local,
            extra_kwargs: {
              base_url: "http://proxy:8080/v1",
              temperature: 0.5,
            },
          },
        },
      };
      vi.mocked(useConfigStore).mockReturnValue({
        ...mockStore,
        config: draft,
        loadedConfig: committed,
        updateConfigValue,
      } as never);
      rerender(<ModelConfig />);

      const row = screen.getByDisplayValue("openai_local").closest("tr");
      if (!row) throw new Error("row not found");
      fireEvent.click(within(row).getByRole("button", { name: "Cancel" }));

      expect(updateConfigValue).toHaveBeenCalledWith(
        ["models", "openai_local"],
        committed.models.openai_local,
      );
    });

    it("keeps the edited row when another row's Edit button is clicked", async () => {
      const updateConfigValue = vi.fn();
      const { rerender } = render(<ModelConfig />);
      fireEvent.click(screen.getByText("openai_local"));
      vi.mocked(useConfigStore).mockReturnValue({
        ...withEditedExtraKwargs(),
        updateConfigValue,
      } as never);
      rerender(<ModelConfig />);

      fireEvent.click(screen.getAllByTitle("Edit")[0]);
      const { toast } = await import("@/components/ui/toaster");
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Finish current edit first" }),
      );

      const row = screen.getByDisplayValue("openai_local").closest("tr");
      if (!row) throw new Error("row not found");
      fireEvent.click(within(row).getByRole("button", { name: "Cancel" }));
      expect(updateConfigValue).toHaveBeenCalledWith(
        ["models", "openai_local"],
        mockStore.config.models.openai_local,
      );
    });

    it("reverts More settings edits when the row edit is cancelled", () => {
      const updateConfigValue = vi.fn();
      const { rerender } = render(<ModelConfig />);
      fireEvent.click(screen.getByText("openai_local"));
      vi.mocked(useConfigStore).mockReturnValue({
        ...withEditedExtraKwargs(),
        updateConfigValue,
      } as never);
      rerender(<ModelConfig />);

      const row = screen.getByDisplayValue("openai_local").closest("tr");
      if (!row) throw new Error("row not found");
      fireEvent.click(within(row).getByRole("button", { name: "Cancel" }));

      expect(updateConfigValue).toHaveBeenCalledWith(
        ["models", "openai_local"],
        mockStore.config.models.openai_local,
      );
    });
  });
});
