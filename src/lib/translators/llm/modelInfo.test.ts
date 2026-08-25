import type { LLMProfile } from './LLMTranslator';
import {
  createLLMClientOptions,
  FALLBACK_CONTEXT_WINDOW_TOKENS,
  FALLBACK_MAX_CONCURRENT_REQUESTS,
  FALLBACK_PREFERRED_INPUT_TOKENS,
  fetchLLMModels,
  getEffectiveLLMApiUrl,
  getLLMDiscoveryIdentity,
  loadLLMExecutionSettings,
  resolveLLMExecutionSettings,
  resolveLLMProfileConnection,
  type LLMModelInfo,
} from './modelInfo';
import { llmProviderPresets } from './presets';

const makeProfile = (overrides: Partial<LLMProfile> = {}): LLMProfile => ({
  ...structuredClone(llmProviderPresets.custom),
  name: 'Test',
  apiUrl: 'https://llm.example/v1',
  model: 'test-model',
  ...overrides,
});

const listResponse = (data: unknown[], status = 200) =>
  new Response(JSON.stringify({ object: 'list', data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('fetchLLMModels metadata decoding', () => {
  const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
    listResponse([]),
  );

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('decodes OpenRouter limits with minimum positive wins', async () => {
    fetchMock.mockImplementationOnce(async () =>
      listResponse([
        {
          id: 'vendor/model',
          name: 'Vendor Model',
          context_length: 200000,
          per_request_limits: { prompt_tokens: 50000, completion_tokens: 8000 },
          top_provider: { context_length: 128000, max_completion_tokens: 16000 },
          pricing: { prompt: '0.000002', completion: '0.000004' },
          supported_parameters: ['temperature', 'tools', 42],
        },
      ]),
    );

    const models = await fetchLLMModels({
      provider: 'openrouter',
      apiUrl: '',
      apiKey: 'or-key',
    });

    expect(models).toHaveLength(1);
    expect(models[0]).toEqual({
      id: 'vendor/model',
      displayName: 'Vendor Model',
      // `top_provider.context_length` is smaller than the top-level `context_length`
      contextWindowTokens: 128000,
      contextWindowSource: 'provider',
      // `per_request_limits.prompt_tokens` below the context length becomes the input cap
      maxInputTokens: 50000,
      maxInputSource: 'provider',
      // conflicting output fields choose the minimum positive value
      maxOutputTokens: 8000,
      maxOutputSource: 'provider',
      inputPricePerMillionTokens: 2,
      outputPricePerMillionTokens: 4,
      supportedParameters: ['temperature', 'tools'],
      tokenizerId: null,
      supportsPrefixCaching: null,
    });
  });

  test('keeps a valid OpenRouter ID when optional metadata is malformed', async () => {
    fetchMock.mockImplementationOnce(async () =>
      listResponse([
        {
          id: 'vendor/messy',
          name: 42,
          context_length: 'lots',
          per_request_limits: 'none',
          top_provider: { context_length: -5, max_completion_tokens: 0 },
          supported_parameters: 'temperature',
        },
        { id: 7 },
        'not-an-object',
      ]),
    );

    const models = await fetchLLMModels({
      provider: 'openrouter',
      apiUrl: '',
      apiKey: '',
    });

    expect(models).toEqual([
      {
        id: 'vendor/messy',
        displayName: 'vendor/messy',
        contextWindowSource: null,
        contextWindowTokens: null,
        maxInputTokens: null,
        maxInputSource: null,
        maxOutputTokens: null,
        maxOutputSource: null,
        inputPricePerMillionTokens: null,
        outputPricePerMillionTokens: null,
        supportedParameters: null,
        tokenizerId: null,
        supportsPrefixCaching: null,
      },
    ]);
  });
  test('returns null for missing or invalid OpenRouter prices', async () => {
    fetchMock.mockImplementationOnce(async () =>
      listResponse([
        {
          id: 'vendor/invalid-prices',
          pricing: { prompt: '', completion: 'not-a-number' },
        },
        {
          id: 'vendor/partial-price',
          pricing: { prompt: '-0.000001', completion: '0' },
        },
      ]),
    );

    const models = await fetchLLMModels({
      provider: 'openrouter',
      apiUrl: '',
      apiKey: '',
    });

    expect(models).toEqual([
      expect.objectContaining({
        id: 'vendor/invalid-prices',
        inputPricePerMillionTokens: null,
        outputPricePerMillionTokens: null,
      }),
      expect.objectContaining({
        id: 'vendor/partial-price',
        inputPricePerMillionTokens: null,
        outputPricePerMillionTokens: 0,
      }),
    ]);
  });

  test('prefers Anthropic display_name and reports no limits', async () => {
    fetchMock.mockImplementationOnce(async () =>
      listResponse([
        { type: 'model', id: 'claude-a', display_name: 'Claude A', created_at: 0 },
        { type: 'model', id: 'claude-b', display_name: '', created_at: 0 },
      ]),
    );

    const models = await fetchLLMModels({
      provider: 'anthropic',
      apiUrl: '',
      apiKey: 'key',
    });

    expect(models.map((model) => model.displayName)).toEqual(['Claude A', 'claude-b']);
    expect(models[0].contextWindowTokens).toBeNull();
    expect(models[0].maxOutputTokens).toBeNull();
  });

  test('decodes OpenAI-compatible limits and display-name precedence', async () => {
    fetchMock.mockImplementationOnce(async () =>
      listResponse([
        {
          id: 'model-a',
          display_name: 'Pretty A',
          name: 'Named A',
          context_length: 8192,
          max_input_tokens: 6144,
          max_completion_tokens: 2048,
          max_output_tokens: 1024,
        },
        { id: 'model-b', display_name: '', name: 'Named B' },
        { id: 'model-c' },
      ]),
    );

    const models = await fetchLLMModels({
      provider: 'openai-compatible',
      apiUrl: 'https://llm.example/v1',
      apiKey: '',
    });

    expect(models.map((model) => model.displayName)).toEqual([
      'Pretty A',
      'Named B',
      'model-c',
    ]);
    expect(models[0]).toMatchObject({
      contextWindowTokens: 8192,
      maxInputTokens: 6144,
      // conflicting output fields choose the minimum positive value
      maxOutputTokens: 1024,
    });
    // unknown output remains null
    expect(models[1].maxOutputTokens).toBeNull();
  });

  test('fills registered Ling contexts when provider metadata is absent', async () => {
    fetchMock.mockImplementationOnce(async () =>
      listResponse([
        { id: 'Ling-3.0-flash', object: 'model' },
        { id: 'Ling-3.0-tiny', object: 'model' },
      ]),
    );

    const models = await fetchLLMModels({
      provider: 'openai-compatible',
      apiUrl: 'https://api.ant-ling.com/v1',
      apiKey: '',
    });

    expect(models[0]).toMatchObject({
      id: 'Ling-3.0-flash',
      contextWindowTokens: 262144,
      contextWindowSource: 'known-model',
    });
    expect(models[1]).toMatchObject({
      id: 'Ling-3.0-tiny',
      contextWindowTokens: 262_144,
      contextWindowSource: 'known-model',
    });
  });

  test('keeps provider metadata precedence over known-model metadata', async () => {
    fetchMock.mockImplementationOnce(async () =>
      listResponse([{ id: 'Ling-3.0-flash', context_length: 131072 }]),
    );

    const models = await fetchLLMModels({
      provider: 'openai-compatible',
      apiUrl: 'https://api.ant-ling.com/v1',
      apiKey: '',
    });

    expect(models[0]).toMatchObject({
      contextWindowTokens: 131072,
      contextWindowSource: 'provider',
    });
  });
});

describe('URL and discovery identity normalization', () => {
  test('resolves empty URLs to provider defaults and strips trailing slashes', () => {
    expect(getEffectiveLLMApiUrl({ provider: 'openai', apiUrl: '' })).toBe(
      'https://api.openai.com/v1',
    );
    expect(
      getEffectiveLLMApiUrl({
        provider: 'openai-compatible',
        apiUrl: 'https://x.test/v1//',
      }),
    ).toBe('https://x.test/v1');
  });

  test('resolves empty and custom profile connections for provider clients', () => {
    expect(
      resolveLLMProfileConnection({
        provider: 'openai',
        apiUrl: '',
        apiKey: '',
        model: 'gpt-4.1',
      }),
    ).toEqual({
      provider: 'openai',
      apiUrl: undefined,
      apiKey: undefined,
      model: 'gpt-4.1',
    });

    expect(
      resolveLLMProfileConnection({
        provider: 'openai-compatible',
        apiUrl: 'https://x.test/v1//',
        apiKey: 'secret',
        model: 'custom-model',
      }),
    ).toEqual({
      provider: 'openai-compatible',
      apiUrl: 'https://x.test/v1',
      apiKey: 'secret',
      model: 'custom-model',
    });
  });

  test('creates raw non-empty client options', () => {
    expect(
      createLLMClientOptions({
        provider: 'openai-compatible',
        apiUrl: 'https://x.test/v1//',
        apiKey: 'secret',
      }),
    ).toEqual({
      apiUrl: 'https://x.test/v1//',
      apiKey: 'secret',
    });
    expect(
      createLLMClientOptions({
        provider: 'openai',
        apiUrl: '',
        apiKey: '',
      }),
    ).toEqual({});
  });

  test('discovery identity covers provider, normalized URL, and key', () => {
    const a = getLLMDiscoveryIdentity({
      provider: 'openai-compatible',
      apiUrl: 'https://llm.example/v1/',
      apiKey: 'k1',
    });
    expect(a).toBe(
      getLLMDiscoveryIdentity({
        provider: 'openai-compatible',
        apiUrl: 'https://llm.example/v1',
        apiKey: 'k1',
      }),
    );
    expect(a).not.toBe(
      getLLMDiscoveryIdentity({
        provider: 'openai-compatible',
        apiUrl: 'https://llm.example/v1',
        apiKey: 'k2',
      }),
    );
  });
});

describe('resolveLLMExecutionSettings precedence', () => {
  const providerInfo = (overrides: Partial<LLMModelInfo> = {}): LLMModelInfo => ({
    id: 'test-model',
    displayName: 'Test Model',
    contextWindowTokens: 32768,
    maxInputTokens: 16384,
    maxOutputTokens: 4096,
    inputPricePerMillionTokens: null,
    outputPricePerMillionTokens: null,
    supportedParameters: ['temperature'],
    tokenizerId: null,
    supportsPrefixCaching: null,
    contextWindowSource: 'provider',
    maxInputSource: 'provider',
    maxOutputSource: 'provider',
    ...overrides,
  });

  test('prefers overrides, then provider metadata, then known models, then fallback', () => {
    expect(
      resolveLLMExecutionSettings(
        makeProfile({ contextWindowTokens: 512 }),
        providerInfo(),
      ),
    ).toMatchObject({ contextWindowTokens: 512, contextWindowSource: 'override' });

    expect(resolveLLMExecutionSettings(makeProfile(), providerInfo())).toMatchObject({
      contextWindowTokens: 32768,
      contextWindowSource: 'provider',
    });

    // flash resolves to 262,144 from known-model metadata without provider data
    expect(
      resolveLLMExecutionSettings(makeProfile({ model: 'Ling-3.0-flash' }), null),
    ).toMatchObject({ contextWindowTokens: 262144, contextWindowSource: 'known-model' });

    // The direct and provider-qualified IDs share registered parameters.
    expect(
      resolveLLMExecutionSettings(makeProfile({ model: 'Ling-3.0-tiny' }), null),
    ).toMatchObject({
      contextWindowTokens: 262_144,
      contextWindowSource: 'known-model',
    });

    for (const model of ['inclusionai/ling-3.0-flash', 'inclusionai/ling-3.0-tiny']) {
      expect(
        resolveLLMExecutionSettings(
          makeProfile({ provider: 'openrouter', apiUrl: '', model }),
          null,
        ),
      ).toMatchObject({
        contextWindowTokens: 262_144,
        contextWindowSource: 'known-model',
      });
    }

    const providers: LLMProfile['provider'][] = ['openrouter', 'openai-compatible'];
    for (const provider of providers) {
      expect(
        resolveLLMExecutionSettings(
          makeProfile({
            provider,
            apiUrl: '',
            model: 'tencent/hy-mt2-30b-a3b',
          }),
          null,
        ),
      ).toMatchObject({
        contextWindowTokens: 8192,
        contextWindowSource: 'known-model',
      });
    }
  });

  test('resolves preferred input and concurrency defaults', () => {
    const resolved = resolveLLMExecutionSettings(makeProfile(), null);
    expect(resolved).toMatchObject({
      preferredInputTokens: FALLBACK_PREFERRED_INPUT_TOKENS,
      preferredInputSource: 'fallback',
      maxConcurrentRequests: FALLBACK_MAX_CONCURRENT_REQUESTS,
      concurrencySource: 'fallback',
    });

    expect(
      resolveLLMExecutionSettings(
        makeProfile({ preferredInputTokens: 600, maxConcurrentRequests: 4 }),
        null,
      ),
    ).toMatchObject({
      preferredInputTokens: 600,
      preferredInputSource: 'override',
      maxConcurrentRequests: 4,
      concurrencySource: 'override',
    });
  });

  test('resolves the maximum output as the minimum nullable hard cap', () => {
    expect(resolveLLMExecutionSettings(makeProfile(), null).maxOutputTokens).toBeNull();

    expect(
      resolveLLMExecutionSettings(makeProfile(), providerInfo({ maxOutputTokens: 4096 })),
    ).toMatchObject({ maxOutputTokens: 4096, maxOutputSource: 'provider' });

    expect(
      resolveLLMExecutionSettings(
        makeProfile({ maxOutputTokens: 2048 }),
        providerInfo({ maxOutputTokens: 4096 }),
      ),
    ).toMatchObject({ maxOutputTokens: 2048, maxOutputSource: 'override' });

    expect(
      resolveLLMExecutionSettings(
        makeProfile({ maxOutputTokens: 8192 }),
        providerInfo({ maxOutputTokens: 4096 }),
      ),
    ).toMatchObject({ maxOutputTokens: 4096, maxOutputSource: 'provider' });
  });

  test('exposes provider input caps and supported parameters', () => {
    const resolved = resolveLLMExecutionSettings(makeProfile(), providerInfo());
    expect(resolved).toMatchObject({
      maxInputTokens: 16384,
      maxInputSource: 'provider',
      supportedParameters: ['temperature'],
    });

    expect(resolveLLMExecutionSettings(makeProfile(), null)).toMatchObject({
      maxInputTokens: null,
      maxInputSource: null,
      supportedParameters: null,
    });
  });
  test('preserves the exact matched model metadata object', () => {
    const info = providerInfo();
    expect(resolveLLMExecutionSettings(makeProfile(), info).modelInfo).toBe(info);
  });
});

describe('loadLLMExecutionSettings', () => {
  const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
    listResponse([]),
  );

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('resolves selected model metadata for discoverable providers', async () => {
    fetchMock.mockImplementationOnce(async () =>
      listResponse([
        { id: 'other-model', context_length: 1024 },
        { id: 'test-model', context_length: 65536, max_output_tokens: 2048 },
      ]),
    );

    const resolved = await loadLLMExecutionSettings(makeProfile());
    expect(resolved).toMatchObject({
      contextWindowTokens: 65536,
      contextWindowSource: 'provider',
      maxOutputTokens: 2048,
    });
    expect(resolved.modelInfo).not.toBeNull();
    expect(resolved.modelInfo?.id).toBe('test-model');
  });

  test('falls back without a request for OpenAI and Anthropic profiles', async () => {
    const resolved = await loadLLMExecutionSettings(
      makeProfile({ provider: 'anthropic', apiUrl: '' }),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(resolved).toMatchObject({
      contextWindowTokens: FALLBACK_CONTEXT_WINDOW_TOKENS,
      contextWindowSource: 'fallback',
    });
  });

  test('falls back when discovery fails or the model is missing', async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new Error('network down');
    });
    const failed = await loadLLMExecutionSettings(makeProfile());
    expect(failed.contextWindowSource).toBe('fallback');

    fetchMock.mockImplementationOnce(async () => listResponse([{ id: 'other-model' }]));
    const missing = await loadLLMExecutionSettings(makeProfile());
    expect(missing.contextWindowSource).toBe('fallback');
  });
});
